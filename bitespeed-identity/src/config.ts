import dotenv from "dotenv";
dotenv.config();

export const config = {
  /** Server port */
  PORT: parseInt(process.env.PORT || "3000", 10),

  /** Node environment */
  NODE_ENV: process.env.NODE_ENV || "development",

  /** Rate limiting: max requests per window */
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),

  /** Rate limiting: window in minutes */
  RATE_LIMIT_WINDOW_MINUTES: parseInt(
    process.env.RATE_LIMIT_WINDOW_MINUTES || "15",
    10
  ),
} as const;
