import express from "express";
import { config } from "./config";
import { logger } from "./logger";
import {
  helmetMiddleware,
  corsMiddleware,
  rateLimiter,
  JSON_BODY_LIMIT,
  requestLogger,
  enforceJsonContentType,
  notFoundHandler,
  globalErrorHandler,
} from "./middleware";
import routes from "./routes";
import { prisma, checkDatabaseConnection } from "./db";

// ─── Build Express app ─────────────────────────────────────────────────────
const app = express();

// Disable x-powered-by header
app.disable("x-powered-by");

// Trust proxy (required for correct IP in rate limiter behind Render/nginx)
app.set("trust proxy", 1);

// ─── Security & parsing middleware (order matters) ─────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(rateLimiter);
app.use(requestLogger);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(enforceJsonContentType);

// ─── Health check (verifies DB connectivity) ───────────────────────────────
app.get("/health", async (_req, res) => {
  const dbOk = await checkDatabaseConnection();
  const status = dbOk ? "ok" : "degraded";
  const httpCode = dbOk ? 200 : 503;

  res.status(httpCode).json({
    status,
    timestamp: new Date().toISOString(),
    database: dbOk ? "connected" : "unreachable",
    uptime: process.uptime(),
  });
});

// ─── API routes ────────────────────────────────────────────────────────────
app.use(routes);

// ─── 404 + global error handler (must be last) ────────────────────────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ─── Start server ──────────────────────────────────────────────────────────
const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    "Identity Reconciliation service started"
  );
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down gracefully...");

  server.close(async () => {
    await prisma.$disconnect();
    logger.info("Database connection closed. Goodbye.");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled Rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught Exception — shutting down");
  process.exit(1);
});

export default app;

