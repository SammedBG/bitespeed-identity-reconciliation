import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { logger } from "./logger";

// ─── Helmet — secure HTTP headers ──────────────────────────────────────────
export const helmetMiddleware = helmet({
  contentSecurityPolicy: config.NODE_ENV === "production" ? undefined : false,
  crossOriginEmbedderPolicy: false,
});

// ─── CORS ──────────────────────────────────────────────────────────────────
export const corsMiddleware = cors({
  origin: config.CORS_ORIGIN === "*" ? "*" : config.CORS_ORIGIN.split(","),
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400, // 24h preflight cache
});

// ─── Rate Limiter ──────────────────────────────────────────────────────────
export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  handler: (req, res, _next, options) => {
    logger.warn(
      { ip: req.ip, path: req.path },
      "Rate limit exceeded"
    );
    res.status(options.statusCode).json(options.message);
  },
});

// ─── Body size limit constant ──────────────────────────────────────────────
export const JSON_BODY_LIMIT = "10kb";

// ─── Request logger ────────────────────────────────────────────────────────
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip,
      },
      "request completed"
    );
  });
  next();
}

// ─── Content-Type enforcement for POST ─────────────────────────────────────
export function enforceJsonContentType(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method === "POST" && !req.is("application/json")) {
    res.status(415).json({
      error: "Unsupported Media Type",
      message: "Content-Type must be application/json",
    });
    return;
  }
  next();
}

// ─── 404 handler ───────────────────────────────────────────────────────────
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

// ─── Global error handler ──────────────────────────────────────────────────
export function globalErrorHandler(
  err: Error & { statusCode?: number; isOperational?: boolean },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const isProduction = config.NODE_ENV === "production";

  logger.error(
    {
      err,
      statusCode,
      isOperational: err.isOperational ?? false,
    },
    err.message
  );

  res.status(statusCode).json({
    error: statusCode === 500 ? "Internal Server Error" : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

