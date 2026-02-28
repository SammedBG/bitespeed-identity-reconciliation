import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

/**
 * Singleton Prisma client instance.
 * Prevents multiple client instances in development (hot-reload).
 *
 * Uses PostgreSQL as the backing store.
 * Logs queries at warn/error level; full query logging avoided in prod.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [
            { level: "query", emit: "event" },
            { level: "warn", emit: "stdout" },
            { level: "error", emit: "stdout" },
          ]
        : [{ level: "error", emit: "stdout" }],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Verify database connectivity.
 * Called at startup and from the /health endpoint.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, "Database connectivity check failed");
    return false;
  }
}
