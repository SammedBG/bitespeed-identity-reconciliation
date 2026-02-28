import { Router, Request, Response, NextFunction } from "express";
import { identifySchema } from "./schemas";
import { identify } from "./service";
import { AppError } from "./errors";
import { ZodError } from "zod";

const router = Router();

/**
 * POST /identify
 *
 * Receives { email?, phoneNumber? } and returns
 * the consolidated contact information.
 */
router.post(
  "/identify",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // ── Validate request body ──────────────────────────────────────
      const parsed = identifySchema.safeParse(req.body);

      if (!parsed.success) {
        const messages = parsed.error.issues.map(
          (issue: { message: string }) => issue.message
        );
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
