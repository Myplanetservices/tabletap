import { defineConfig } from "@neon/config/v1";

// TableTap on Neon: Lakebase Postgres only (every branch has it, so there is
// nothing to declare for it). `neon deploy` applies this to the linked branch
// and pulls DATABASE_URL / DATABASE_URL_UNPOOLED into .env.
//   App traffic   api/_lib/pg.js      pooled DATABASE_URL (node-postgres)
//   Migrations    scripts/migrate.js  direct DATABASE_URL_UNPOOLED
export default defineConfig({
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
