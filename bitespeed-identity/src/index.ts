import express from "express";
import { config } from "./config";
import {
  helmetMiddleware,
  corsMiddleware,
  rateLimiter,
  JSON_BODY_LIMIT,
  notFoundHandler,
  globalErrorHandler,
} from "./middleware";
import routes from "./routes";
import { prisma } from "./db";

// ── Build Express app ──────────────────────────────────────────────────────
const app = express();

// ── Security & parsing middleware (order matters) ──────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(rateLimiter);
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// Reject non-JSON content types on POST
app.use((req, res, next) => {
  if (
    req.method === "POST" &&
    !req.is("application/json")
  ) {
    res.status(415).json({
      error: "Unsupported Media Type",
      message: "Content-Type must be application/json",
    });
    return;
  }
  next();
});

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use(routes);

// ── 404 + global error handler (must be last) ─────────────────────────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ── Start server ───────────────────────────────────────────────────────────
const server = app.listen(config.PORT, () => {
  console.log(
    `[server] Identity Reconciliation service running on port ${config.PORT}`
  );
  console.log(`[server] Environment: ${config.NODE_ENV}`);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log("[server] Database connection closed.");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Catch unhandled rejections / uncaught exceptions
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught Exception:", err);
  process.exit(1);
});

export default app;
