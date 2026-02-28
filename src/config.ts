import dotenv from "dotenv";
dotenv.config();

/**
 * Centralized, validated application configuration.
 * All environment variables are parsed and defaulted here.
 */
export const config = {
  /** Server port */
  PORT: parseInt(process.env.PORT || "3000", 10),

  /** Node environment */
  NODE_ENV: process.env.NODE_ENV || "development",

  /** Database connection string */
  DATABASE_URL: process.env.DATABASE_URL || "",

  /** Rate limiting: max requests per window */
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),

  /** Rate limiting: window in minutes */
  RATE_LIMIT_WINDOW_MINUTES: parseInt(
    process.env.RATE_LIMIT_WINDOW_MINUTES || "15",
    10
  ),

  /** CORS allowed origins (comma-separated, or "*") */
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",

  /** Log level */
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
} as const;
