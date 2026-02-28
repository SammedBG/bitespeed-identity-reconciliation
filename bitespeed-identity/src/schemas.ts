import { z } from "zod";

/**
 * Strict validation schema for /identify request body.
 *
 * Rules:
 *  - At least one of email or phoneNumber must be provided (non-null).
 *  - email, if provided, must be a valid email string.
 *  - phoneNumber, if provided, is coerced to a trimmed string (the spec
 *    shows it as both number and string in examples).
 */
export const identifySchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Invalid email format")
      .max(320, "Email too long")
      .nullable()
      .optional()
      .transform((v) => v ?? null),
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
          .max(20, "Phone number too long")
          .regex(
            /^[+]?[\d\s\-()]+$/,
            "Phone number contains invalid characters"
          )
          .nullable()
      ),
  })
  .refine((data) => data.email !== null || data.phoneNumber !== null, {
    message: "At least one of email or phoneNumber must be provided",
  });

export type IdentifyInput = z.infer<typeof identifySchema>;
