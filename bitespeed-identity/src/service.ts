import { Contact } from "@prisma/client";
import { prisma } from "./db";

/** Shape returned by the /identify endpoint */
export interface IdentifyResponse {
  contact: {
    primaryContatctId: number; // intentional typo to match spec
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

/**
 * Core identity reconciliation logic.
 *
 * Algorithm:
 * 1. Find all contacts matching the given email OR phoneNumber.
 * 2. Resolve every match to its root primary contact.
 * 3. If multiple distinct primaries exist, merge them (older stays primary,
 *    newer becomes secondary, and all of newer's secondaries re-link).
 * 4. If the request brings new information (new email or phone),
 *    create a secondary contact.
 * 5. If no contacts exist at all, create a new primary contact.
 * 6. Return the consolidated contact payload.
 */
export async function identify(
  email: string | null,
  phoneNumber: string | null
): Promise<IdentifyResponse> {
  return await prisma.$transaction(async (tx) => {
    // ── Step 1: Find all matching contacts ──────────────────────────────
    const whereConditions: object[] = [];
    if (email) whereConditions.push({ email });
    if (phoneNumber) whereConditions.push({ phoneNumber });

    const matchingContacts = await tx.contact.findMany({
      where: {
        deletedAt: null,
        OR: whereConditions.length > 0 ? whereConditions : undefined,
      },
      orderBy: { createdAt: "asc" },
    });

    // ── Step 2: No matches → create new primary ────────────────────────
    if (matchingContacts.length === 0) {
      const newContact = await tx.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "primary",
        },
      });
      return buildResponse(newContact, []);
    }

    // ── Step 3: Resolve all distinct primary contacts ──────────────────
    const primaryIds = new Set<number>();
    const primaryMap = new Map<number, Contact>();

    for (const c of matchingContacts) {
      const rootId = c.linkPrecedence === "primary" ? c.id : c.linkedId!;
      primaryIds.add(rootId);
    }

    // Fetch all primary contacts we found
    const primaries = await tx.contact.findMany({
      where: { id: { in: Array.from(primaryIds) }, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    for (const p of primaries) {
      primaryMap.set(p.id, p);
    }

    // ── Step 4: Merge if multiple primaries found ─────────────────────
    // The oldest primary wins; all others become secondary
    const sortedPrimaries = Array.from(primaryMap.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    const rootPrimary = sortedPrimaries[0];

    if (sortedPrimaries.length > 1) {
      for (let i = 1; i < sortedPrimaries.length; i++) {
        const demoted = sortedPrimaries[i];

        // Demote this primary → secondary
        await tx.contact.update({
          where: { id: demoted.id },
          data: {
            linkedId: rootPrimary.id,
            linkPrecedence: "secondary",
          },
        });

        // Re-link all of the demoted primary's secondaries to the root
        await tx.contact.updateMany({
          where: { linkedId: demoted.id, deletedAt: null },
          data: { linkedId: rootPrimary.id },
        });
      }
    }

    // ── Step 5: Check if request brings new information ───────────────
    // Fetch all contacts now linked to the root primary
    const allLinked = await tx.contact.findMany({
      where: {
        deletedAt: null,
        OR: [{ id: rootPrimary.id }, { linkedId: rootPrimary.id }],
      },
      orderBy: { createdAt: "asc" },
    });

    const existingEmails = new Set(
      allLinked.map((c) => c.email).filter(Boolean)
    );
    const existingPhones = new Set(
      allLinked.map((c) => c.phoneNumber).filter(Boolean)
    );

    const hasNewEmail = email !== null && !existingEmails.has(email);
    const hasNewPhone =
      phoneNumber !== null && !existingPhones.has(phoneNumber);

    // Check for exact duplicate row (same email AND phone already in group)
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
      allLinked.push(newSecondary);
    }

    // ── Step 6: Build response ────────────────────────────────────────
    const secondaries = allLinked.filter(
      (c) => c.id !== rootPrimary.id
    );

    return buildResponse(rootPrimary, secondaries);
  });
}

/**
 * Build the consolidated response payload.
 * Primary contact's email/phone always come first in the arrays.
 */
function buildResponse(
  primary: Contact,
  secondaries: Contact[]
): IdentifyResponse {
  // Deduplicated, ordered: primary first
  const emails: string[] = [];
  const phoneNumbers: string[] = [];

  if (primary.email) emails.push(primary.email);
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);

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
      primaryContatctId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: secondaries.map((s) => s.id),
    },
  };
}
