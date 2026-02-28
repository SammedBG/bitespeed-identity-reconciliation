import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config";

/**
 * Helmet — sets secure HTTP headers (XSS protection, HSTS, etc.)
 */
export const helmetMiddleware = helmet();

/**
 * CORS — allow all origins for this demo service.
 * In production, restrict to specific domains.
 */
export const corsMiddleware = cors({
  origin: "*",
  methods: ["POST", "GET"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

/**
 * Rate limiter — prevents abuse / DDoS.
 */
export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later.",
  },
});

/**
 * Reject requests with bodies larger than expected.
 * Express's built-in json() parser has a default limit of 100kb,
 * but we further restrict it via this constant.
 */
export const JSON_BODY_LIMIT = "10kb";

/**
 * 404 handler — catch-all for undefined routes.
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} does not exist`,
  });
}

/**
 * Global error handler — catches all unhandled errors.
 * Never leaks stack traces in production.
 */
export function globalErrorHandler(
  err: Error & { statusCode?: number; isOperational?: boolean },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const isProduction = config.NODE_ENV === "production";

  // Log the error for debugging
  console.error(`[ERROR] ${err.message}`, {
    statusCode,
    stack: isProduction ? undefined : err.stack,
    timestamp: new Date().toISOString(),
  });

  res.status(statusCode).json({
    error: statusCode === 500 ? "Internal Server Error" : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
