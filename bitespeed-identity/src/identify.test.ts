import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { PrismaClient } from "@prisma/client";

// ─── Setup test app ────────────────────────────────────────────────────────

const prisma = new PrismaClient();

// We build a minimal app for testing (no rate-limiting or helmet needed)
async function buildTestApp() {
  // Dynamic import so env is loaded first
  const { default: routes } = await import("./routes");
  const app = express();
  app.use(express.json());
  app.use(routes);
  return app;
}

let app: express.Express;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean the Contact table before each test
  await prisma.contact.deleteMany({});
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("POST /identify", () => {
  // ── Validation tests ───────────────────────────────────────────────────

  describe("validation", () => {
    it("should return 400 when body is empty", async () => {
      const res = await request(app)
        .post("/identify")
        .send({})
        .expect(400);

      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toContain(
        "At least one of email or phoneNumber must be provided"
      );
    });

    it("should return 400 when both email and phoneNumber are null", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: null, phoneNumber: null })
        .expect(400);

      expect(res.body.error).toBe("Validation failed");
    });

    it("should return 400 for invalid email format", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "not-an-email" })
        .expect(400);

      expect(res.body.details).toBeDefined();
    });

    it("should return 400 for invalid phone characters", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: "abc$def" })
        .expect(400);

      expect(res.body.details).toBeDefined();
    });

    it("should accept phoneNumber as a number and coerce to string", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: 123456 })
        .expect(200);

      expect(res.body.contact.phoneNumbers).toContain("123456");
    });
  });

  // ── Scenario 1: No match → new primary ────────────────────────────────

  describe("new customer (no existing contacts)", () => {
    it("should create a new primary contact", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu", phoneNumber: "555-0100" })
        .expect(200);

      expect(res.body.contact).toMatchObject({
        emails: ["doc@hillvalley.edu"],
        phoneNumbers: ["555-0100"],
        secondaryContactIds: [],
      });
      expect(res.body.contact.primaryContactId).toBeTypeOf("number");
    });

    it("should create primary with email only", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu" })
        .expect(200);

      expect(res.body.contact.emails).toEqual(["doc@hillvalley.edu"]);
      expect(res.body.contact.phoneNumbers).toEqual([]);
    });

    it("should create primary with phone only", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: "555-0100" })
        .expect(200);

      expect(res.body.contact.phoneNumbers).toEqual(["555-0100"]);
      expect(res.body.contact.emails).toEqual([]);
    });
  });

  // ── Scenario 2: Partial match → create secondary ─────────────────────

  describe("partial match (new info → secondary)", () => {
    it("should link new email to existing phone", async () => {
      // First request: create primary
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      // Second request: same phone, new email
      const res = await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" })
        .expect(200);

      expect(res.body.contact.emails).toEqual([
        "lorraine@hillvalley.edu",
        "mcfly@hillvalley.edu",
      ]);
      expect(res.body.contact.phoneNumbers).toEqual(["123456"]);
      expect(res.body.contact.secondaryContactIds).toHaveLength(1);
    });

    it("should link new phone to existing email", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu", phoneNumber: "111" });

      const res = await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu", phoneNumber: "222" })
        .expect(200);

      expect(res.body.contact.phoneNumbers).toEqual(["111", "222"]);
      expect(res.body.contact.secondaryContactIds).toHaveLength(1);
    });
  });

  // ── Scenario 3: Exact match → idempotent, no duplicate ───────────────

  describe("idempotency (exact match → no new row)", () => {
    it("should not create a duplicate contact on repeated request", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      // Exact same request again
      const res = await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" })
        .expect(200);

      expect(res.body.contact.secondaryContactIds).toHaveLength(0);
    });

    it("should return full group when queried by phone only", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: "123456" })
        .expect(200);

      expect(res.body.contact.emails).toEqual([
        "lorraine@hillvalley.edu",
        "mcfly@hillvalley.edu",
      ]);
    });
  });

  // ── Scenario 4: Two primaries → merge ────────────────────────────────

  describe("merging two primaries", () => {
    it("should merge when request links two separate primary groups", async () => {
      // Create two independent primaries
      await request(app)
        .post("/identify")
        .send({ email: "george@hillvalley.edu", phoneNumber: "919191" });

      await request(app)
        .post("/identify")
        .send({ email: "biffsucks@hillvalley.edu", phoneNumber: "717171" });

      // This request links george's email with biff's phone
      const res = await request(app)
        .post("/identify")
        .send({
          email: "george@hillvalley.edu",
          phoneNumber: "717171",
        })
        .expect(200);

      // George's contact should be the root (created first)
      expect(res.body.contact.emails).toContain("george@hillvalley.edu");
      expect(res.body.contact.emails).toContain("biffsucks@hillvalley.edu");
      expect(res.body.contact.phoneNumbers).toContain("919191");
      expect(res.body.contact.phoneNumbers).toContain("717171");
      // At least one secondary (the demoted primary)
      expect(res.body.contact.secondaryContactIds.length).toBeGreaterThanOrEqual(1);
    });

    it("should ensure only one primary after merge", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "a@test.com", phoneNumber: "111" });

      await request(app)
        .post("/identify")
        .send({ email: "b@test.com", phoneNumber: "222" });

      await request(app)
        .post("/identify")
        .send({ email: "c@test.com", phoneNumber: "333" });

      // Link A and B via shared phone
      await request(app)
        .post("/identify")
        .send({ email: "a@test.com", phoneNumber: "222" });

      // Link A-B group and C via shared phone
      const res = await request(app)
        .post("/identify")
        .send({ email: "c@test.com", phoneNumber: "111" })
        .expect(200);

      // All three should be in one group
      expect(res.body.contact.emails).toContain("a@test.com");
      expect(res.body.contact.emails).toContain("b@test.com");
      expect(res.body.contact.emails).toContain("c@test.com");

      // Verify only ONE primary in DB
      const primaryCount = await prisma.contact.count({
        where: {
          linkPrecedence: "primary",
          deletedAt: null,
          OR: [
            { email: { in: ["a@test.com", "b@test.com", "c@test.com"] } },
            { phoneNumber: { in: ["111", "222", "333"] } },
          ],
        },
      });
      expect(primaryCount).toBe(1);
    });
  });

  // ── Response format ──────────────────────────────────────────────────

  describe("response format", () => {
    it("should have primary's email first in emails array", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "primary@test.com", phoneNumber: "100" });

      await request(app)
        .post("/identify")
        .send({ email: "secondary@test.com", phoneNumber: "100" });

      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: "100" })
        .expect(200);

      expect(res.body.contact.emails[0]).toBe("primary@test.com");
    });

    it("should have no duplicate values in arrays", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "same@test.com", phoneNumber: "100" });

      await request(app)
        .post("/identify")
        .send({ email: "same@test.com", phoneNumber: "200" });

      const res = await request(app)
        .post("/identify")
        .send({ email: "same@test.com" })
        .expect(200);

      const uniqueEmails = new Set(res.body.contact.emails);
      expect(uniqueEmails.size).toBe(res.body.contact.emails.length);

      const uniquePhones = new Set(res.body.contact.phoneNumbers);
      expect(uniquePhones.size).toBe(res.body.contact.phoneNumbers.length);
    });
  });
});
