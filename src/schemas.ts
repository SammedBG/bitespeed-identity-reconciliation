import { z } from "zod";

/**
 * Strict validation schema for POST /identify request body.
 *
 * Rules:
 *  - At least one of email or phoneNumber must be provided (non-null, non-empty).
 *  - email, if provided, must be a valid email (RFC 5322), max 320 chars.
 *  - phoneNumber accepts string or number, coerced to trimmed string, max 20 chars.
 *  - phoneNumber must contain only digits, spaces, hyphens, parens, optional leading +.
 *  - Extra/unknown keys are stripped (strict mode).
 */
export const identifySchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email format")
      .max(320, "Email must be at most 320 characters")
      .nullable()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    phoneNumber: z
      .union([z.string(), z.number()])
      .nullable()
      .optional()
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s.length === 0 ? null : s;
      })
      .pipe(
        z
          .string()
          .max(20, "Phone number must be at most 20 characters")
          .regex(
            /^[+]?[\d\s\-()]+$/,
            "Phone number contains invalid characters"
          )
          .nullable()
      ),
  })
  .strict() // reject unknown keys
  .refine((data) => data.email !== null || data.phoneNumber !== null, {
    message: "At least one of email or phoneNumber must be provided",
  });

/** Validated & normalized identify request shape */
export type IdentifyInput = z.infer<typeof identifySchema>;

