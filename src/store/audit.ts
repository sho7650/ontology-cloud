/**
 * audit_log への書き込みと読み出し。
 */
import type { Props } from "../ontology/schema";

export type AuditResult = "ok" | "precondition_failed" | "error";

export type AuditEntry = {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  params: Record<string, unknown>;
  before: Props | null;
  after: Props | null;
  result: AuditResult;
  error?: string | null;
};

export type AuditRow = {
  seq: number;
  at: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  params: string | null;
  before: string | null;
  after: string | null;
  result: AuditResult;
  error: string | null;
};

const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

/**
 * batch() に混ぜられるよう prepared statement を返す。
 * onlyIfChanged を付けると、同じバッチ内の直前の文が 1 行変更したときだけ INSERT する
 * (SQLite の changes() は同一接続の直前の文の更新件数)。楽観ロックの UPDATE が空振りしたときに監査行を残さないため。
 */
export function auditStatement(db: D1Database, e: AuditEntry, options: { onlyIfChanged?: boolean } = {}): D1PreparedStatement {
  const values = options.onlyIfChanged ? "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1" : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return db
    .prepare(`INSERT INTO audit_log (actor, action, target_type, target_id, params, before, after, result, error) ${values}`)
    .bind(
      e.actor,
      e.action,
      e.targetType,
      e.targetId,
      json(e.params),
      json(e.before),
      json(e.after),
      e.result,
      e.error ?? null,
    );
}

export async function writeAudit(db: D1Database, e: AuditEntry): Promise<void> {
  await auditStatement(db, e).run();
}

export async function recentAudit(db: D1Database, limit = 100): Promise<AuditRow[]> {
  const { results } = await db.prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?").bind(limit).all<AuditRow>();
  return results;
}
