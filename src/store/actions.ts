/**
 * ActionType の実行: パラメータ検証 → 対象取得 → precondition → effect → 楽観ロック付き UPDATE + 監査。
 *
 * D1 には FOR UPDATE が無いので、読んだ props のテキストと一致する行だけを UPDATE し、
 * 更新件数が 0 なら他の書き込みと競合したとみなして読み直す (最大 MAX_ATTEMPTS 回)。
 */
import { applyEffects, checkConditions } from "../ontology/actions";
import { type Ontology, type Props, actionType, objectType } from "../ontology/schema";
import { validateParams, validateProps } from "../ontology/validate";
import { type AuditEntry, auditStatement, writeAudit } from "./audit";
import { type FlatObject, flatten } from "./objects";

const MAX_ATTEMPTS = 3;

export type ActionResult =
  | { ok: true; object: FlatObject }
  | { ok: false; reason: "precondition_failed"; failed: string[]; object: FlatObject };

type Target = { text: string; props: Props };
type AuditBase = Pick<AuditEntry, "actor" | "action" | "targetType" | "targetId" | "params">;

async function loadTarget(db: D1Database, type: string, id: string): Promise<Target> {
  const row = await db
    .prepare("SELECT props FROM objects WHERE type = ? AND id = ?")
    .bind(type, id)
    .first<{ props: string }>();
  if (!row) throw new Error(`${type}#${id} not found`);
  return { text: row.props, props: JSON.parse(row.props) as Props };
}

export async function executeAction(
  db: D1Database,
  ont: Ontology,
  actor: string,
  actionName: string,
  targetId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const at = actionType(ont, actionName); // 未知のアクションは監査しない
  const base: AuditBase = { actor, action: actionName, targetType: at.target, targetId, params };
  let lastSeen: Props | null = null;
  try {
    validateParams(at, actionName, params);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const target = await loadTarget(db, at.target, targetId);
      lastSeen = target.props;
      const outcome = await attemptAction(db, ont, base, target);
      if (outcome) return outcome;
    }
    throw new Error(`${at.target}#${targetId} was modified concurrently, gave up after ${MAX_ATTEMPTS} attempts`);
  } catch (e) {
    const err = e as Error;
    await writeAudit(db, { ...base, before: lastSeen, after: null, result: "error", error: `${err.name}: ${err.message}` });
    throw e;
  }
}

/** 1 回の試行。競合で UPDATE が空振りしたら null を返す。 */
async function attemptAction(
  db: D1Database,
  ont: Ontology,
  base: AuditBase,
  target: Target,
): Promise<ActionResult | null> {
  const at = actionType(ont, base.action);
  const object = { type: at.target, id: base.targetId };

  const failed = checkConditions(at.preconditions, target.props);
  if (failed.length) {
    await writeAudit(db, { ...base, before: target.props, after: null, result: "precondition_failed" });
    return { ok: false, reason: "precondition_failed", failed, object: flatten({ ...object, props: target.props }) };
  }

  const after = applyEffects(objectType(ont, at.target), at.effects, target.props, base.params);
  validateProps(ont, at.target, after);
  const [update] = await db.batch([
    db
      .prepare(
        "UPDATE objects SET props = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" +
          " WHERE type = ? AND id = ? AND props = ?",
      )
      .bind(JSON.stringify(after), at.target, base.targetId, target.text),
    auditStatement(db, { ...base, before: target.props, after, result: "ok" }, { onlyIfChanged: true }),
  ]);
  return update.meta.changes === 1 ? { ok: true, object: flatten({ ...object, props: after }) } : null;
}
