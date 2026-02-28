import { Contact, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";
import { PRISMA_UNIQUE_CONSTRAINT_CODE } from "./errors";

// ─── Response type ─────────────────────────────────────────────────────────

/** Shape returned by the POST /identify endpoint */
export interface IdentifyResponse {
  contact: {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

// ─── Transaction client alias ──────────────────────────────────────────────

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Identity reconciliation — the core algorithm.
 *
 * Runs entirely inside a serializable Prisma transaction to prevent
 * race conditions where two concurrent requests might both try to
 * create contacts or merge primaries simultaneously.
 *
 * Algorithm:
 *  1. Find all non-deleted contacts matching the given email OR phoneNumber.
 *  2. If no matches → create a new primary contact.
 *  3. Resolve every match to its root primary contact.
 *  4. If multiple distinct primaries → merge (oldest stays primary,
 *     newer ones become secondary, their children re-link).
 *  5. If the request carries new information → create a secondary contact.
 *  6. Return the consolidated contact payload.
 *
 * Concurrency safety:
 *  - The transaction isolation level is Serializable, which prevents
 *    phantom reads and ensures sequential consistency.
 *  - A unique constraint (email, phoneNumber, linkedId) on the Contact
 *    table prevents duplicate inserts even under concurrent requests.
 *  - If a unique constraint violation occurs, we retry by re-fetching.
 */
export async function identify(
  email: string | null,
  phoneNumber: string | null
): Promise<IdentifyResponse> {
  const startMs = Date.now();

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        return await reconcile(tx as unknown as TxClient, email, phoneNumber);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      }
    );

    logger.info(
      {
        email,
        phoneNumber,
        primaryContactId: result.contact.primaryContactId,
        secondaryCount: result.contact.secondaryContactIds.length,
        durationMs: Date.now() - startMs,
      },
      "identify completed"
    );

    return result;
  } catch (err: unknown) {
    // Handle unique constraint race: retry once by re-reading
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === PRISMA_UNIQUE_CONSTRAINT_CODE
    ) {
      logger.warn(
        { email, phoneNumber },
        "Unique constraint hit — retrying with fresh read"
      );
      return await prisma.$transaction(
        async (tx) => {
          return await reconcile(tx as unknown as TxClient, email, phoneNumber);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        }
      );
    }
    throw err;
  }
}

// ─── Core reconciliation logic (runs inside a transaction) ─────────────────

async function reconcile(
  tx: TxClient,
  email: string | null,
  phoneNumber: string | null
): Promise<IdentifyResponse> {
  // ── Step 1: Find all contacts matching email OR phone ──────────────────
  const orConditions: Prisma.ContactWhereInput[] = [];
  if (email) orConditions.push({ email });
  if (phoneNumber) orConditions.push({ phoneNumber });

  const matchingContacts = await tx.contact.findMany({
    where: {
      deletedAt: null,
      OR: orConditions.length > 0 ? orConditions : undefined,
    },
    orderBy: { createdAt: "asc" },
  });

  // ── Step 2: No matches → create new primary ───────────────────────────
  if (matchingContacts.length === 0) {
    const created = await tx.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "primary",
      },
    });

    logger.info(
      { contactId: created.id, email, phoneNumber },
      "Created new primary contact"
    );

    return buildResponse(created, []);
  }

  // ── Step 3: Resolve all distinct root primaries ────────────────────────
  const primaryIds = new Set<number>();

  for (const c of matchingContacts) {
    primaryIds.add(c.linkPrecedence === "primary" ? c.id : c.linkedId!);
  }

  const primaries = await tx.contact.findMany({
    where: { id: { in: Array.from(primaryIds) }, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  // Sorted oldest-first: the first one is the surviving root primary
  const rootPrimary = primaries[0];

  // ── Step 4: Merge if multiple primaries found ─────────────────────────
  if (primaries.length > 1) {
    for (let i = 1; i < primaries.length; i++) {
      const demoted = primaries[i];

      logger.info(
        {
          demotedId: demoted.id,
          rootPrimaryId: rootPrimary.id,
        },
        "Merging: demoting primary to secondary"
      );

      // Demote this primary → secondary of rootPrimary
      await tx.contact.update({
        where: { id: demoted.id },
        data: {
          linkedId: rootPrimary.id,
          linkPrecedence: "secondary",
        },
      });

      // Re-link all children of the demoted primary → rootPrimary
      await tx.contact.updateMany({
        where: { linkedId: demoted.id, deletedAt: null },
        data: { linkedId: rootPrimary.id },
      });
    }
  }

  // ── Step 5: Determine if request carries new information ──────────────
  // Re-fetch the full group after potential merge
  const allLinked = await tx.contact.findMany({
    where: {
      deletedAt: null,
      OR: [{ id: rootPrimary.id }, { linkedId: rootPrimary.id }],
    },
    orderBy: { createdAt: "asc" },
  });

  const existingEmails = new Set(allLinked.map((c) => c.email).filter(Boolean));
  const existingPhones = new Set(
    allLinked.map((c) => c.phoneNumber).filter(Boolean)
  );

  const hasNewEmail = email !== null && !existingEmails.has(email);
  const hasNewPhone = phoneNumber !== null && !existingPhones.has(phoneNumber);

  // Idempotency check: don't create a row if the exact combo exists
  const exactDuplicate = allLinked.some(
    (c) =>
      (email === null || c.email === email) &&
      (phoneNumber === null || c.phoneNumber === phoneNumber)
  );

  if ((hasNewEmail || hasNewPhone) && !exactDuplicate) {
    const newSecondary = await tx.contact.create({
      data: {
        email,
        phoneNumber,
        linkedId: rootPrimary.id,
        linkPrecedence: "secondary",
      },
    });

    logger.info(
      {
        contactId: newSecondary.id,
        linkedTo: rootPrimary.id,
        email,
        phoneNumber,
      },
      "Created new secondary contact"
    );

    allLinked.push(newSecondary);
  }

  // ── Step 6: Build & return response ───────────────────────────────────
  const secondaries = allLinked.filter((c) => c.id !== rootPrimary.id);
  return buildResponse(rootPrimary, secondaries);
}

// ─── Response builder ──────────────────────────────────────────────────────

/**
 * Build the consolidated response payload.
 *
 * Guarantees:
 *  - Primary's email/phone appear first in their respective arrays.
 *  - No duplicate values in arrays.
 *  - Deterministic ordering: primary first, then secondaries by createdAt.
 */
function buildResponse(
  primary: Contact,
  secondaries: Contact[]
): IdentifyResponse {
  const emails: string[] = [];
  const phoneNumbers: string[] = [];

  // Primary first
  if (primary.email) emails.push(primary.email);
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);

  // Then secondaries (already sorted by createdAt)
  for (const s of secondaries) {
    if (s.email && !emails.includes(s.email)) {
      emails.push(s.email);
    }
    if (s.phoneNumber && !phoneNumbers.includes(s.phoneNumber)) {
      phoneNumbers.push(s.phoneNumber);
    }
  }

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: secondaries.map((s) => s.id),
    },
  };
}

