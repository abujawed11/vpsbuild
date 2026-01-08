// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  // DB URL for Prisma Migrate/Studio/etc.
  datasource: {
    url: env("DATABASE_URL"),
  },

  migrations: {
    path: "prisma/migrations",
  },
});
