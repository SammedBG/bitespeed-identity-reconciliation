/**
 * Custom application error with HTTP status code.
 *
 * isOperational = true  → expected errors (bad input, not found, etc.)
 * isOperational = false → programming bugs or infrastructure failures
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Prisma unique constraint violation error code.
 * Used to detect and handle duplicate inserts gracefully.
 */
export const PRISMA_UNIQUE_CONSTRAINT_CODE = "P2002";
