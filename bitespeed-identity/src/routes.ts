import { Router, Request, Response, NextFunction } from "express";
import { identifySchema } from "./schemas";
import { identify } from "./service";
import { logger } from "./logger";

const router = Router();

/**
 * POST /identify
 *
 * Receives { email?, phoneNumber? } and returns the consolidated
 * contact information for that customer identity.
 *
 * Request body is validated with Zod. At least one of email or
 * phoneNumber must be non-null.
 */
router.post(
  "/identify",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // ── Validate & sanitize input ──────────────────────────────────
      const parsed = identifySchema.safeParse(req.body);

      if (!parsed.success) {
        const messages = parsed.error.issues.map(
          (issue: { message: string }) => issue.message
        );
        logger.warn({ body: req.body, errors: messages }, "Validation failed");
        res.status(400).json({
          error: "Validation failed",
          details: messages,
        });
        return;
      }

      const { email, phoneNumber } = parsed.data;

      // ── Execute identity reconciliation ────────────────────────────
      const result = await identify(email, phoneNumber);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

