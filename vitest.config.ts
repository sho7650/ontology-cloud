import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // wrangler secret put で入れる値のテスト用ダミー
          GOOGLE_CLIENT_ID: "test-client-id",
          GOOGLE_CLIENT_SECRET: "test-client-secret",
          COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // Cloudflare のデモから流用した OAuth 配線は Google 本体が無いと通せないので対象外
      exclude: ["src/auth/**"],
      thresholds: { lines: 80, statements: 80 },
    },
  },
});
