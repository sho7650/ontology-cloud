// vitest の setupFiles。各テストファイルの前に D1 マイグレーションを適用する (冪等)。
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
