import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Read directly from process.env so drizzle-kit can run standalone.
    url: process.env.DATABASE_URL ?? "",
  },
});
