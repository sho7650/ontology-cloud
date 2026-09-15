/**
 * D1 のテーブル作成。migrations/0001_init.sql をそのまま同梱し、冪等 (IF NOT EXISTS) に実行する。
 * wrangler d1 migrations apply を使えない環境 (ダッシュボードの GitHub 連携だけでデプロイした場合) 向け。
 */
import initSql from "../../migrations/0001_init.sql";

/** SQL テキストを文単位に分ける (コメント行と空文は捨てる)。 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(splitStatements(initSql).map((s) => db.prepare(s)));
}
