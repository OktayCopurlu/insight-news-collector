// Jest setup: load environment variables for tests.
import dotenv from "dotenv";
import fs from "fs";

// Prefer a dedicated test env file if present
if (fs.existsSync(".env.test")) {
  dotenv.config({ path: ".env.test" });
} else {
  dotenv.config();
}

// Fail fast if running in CI and required Supabase env vars missing
if (process.env.CI) {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // Throwing here will surface a clear message early
    throw new Error(
      `Missing required env vars in CI for tests: ${missing.join(", ")}`
    );
  }
}
