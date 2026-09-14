/**
 * objects / links テーブルの読み取り。props は JSON テキストで保持し、ここで parse する。
 */
import type { Json, LinkType, Props } from "../ontology/schema";

export type StoredObject = { type: string; id: string; props: Props };
/** MCP のレスポンス形: {type, id, ...props} */
export type FlatObject = { type: string; id: string } & Props;

type ObjectRow = { type: string; id: string; props: string };

const SAFE_KEY = /^[A-Za-z0-9_]+$/;

export const toObject = (r: ObjectRow): StoredObject => ({ type: r.type, id: r.id, props: JSON.parse(r.props) as Props });
export const flatten = (o: StoredObject): FlatObject => ({ type: o.type, id: o.id, ...o.props });

/** D1 は boolean を bind できないので 0/1 に落とす (json_extract の真偽値も 0/1 で返る)。 */
const bindable = (v: Json): string | number | null => (typeof v === "boolean" ? (v ? 1 : 0) : v);

export async function searchObjects(
  db: D1Database,
  type: string,
  filter: Record<string, Json>,
  limit: number,
): Promise<StoredObject[]> {
  const keys = Object.keys(filter);
  const bad = keys.find((k) => !SAFE_KEY.test(k));
  if (bad !== undefined) throw new Error(`invalid filter key: ${JSON.stringify(bad)}`);
  const where = ["type = ?", ...keys.map((k) => `json_extract(props, '$."${k}"') = ?`)].join(" AND ");
  const { results } = await db
    .prepare(`SELECT type, id, props FROM objects WHERE ${where} ORDER BY id LIMIT ?`)
    .bind(type, ...keys.map((k) => bindable(filter[k])), limit)
    .all<ObjectRow>();
  return results.map(toObject);
}

export async function getObject(db: D1Database, type: string, id: string): Promise<StoredObject | null> {
  const row = await db
    .prepare("SELECT type, id, props FROM objects WHERE type = ? AND id = ?")
    .bind(type, id)
    .first<ObjectRow>();
  return row ? toObject(row) : null;
}

/** type が link の from 側なら順方向、to 側なら逆方向にたどる。 */
export async function traverse(
  db: D1Database,
  linkName: string,
  link: LinkType,
  type: string,
  id: string,
): Promise<StoredObject[]> {
  const direction =
    type === link.from
      ? { target: link.to, match: "o.id = l.to_id", where: "l.from_id = ?" }
      : type === link.to
        ? { target: link.from, match: "o.id = l.from_id", where: "l.to_id = ?" }
        : null;
  if (!direction) throw new Error(`link ${linkName} does not connect ${type} (${link.from} -> ${link.to})`);
  const { results } = await db
    .prepare(
      `SELECT o.type, o.id, o.props FROM links l JOIN objects o ON o.type = ? AND ${direction.match}` +
        ` WHERE l.type = ? AND ${direction.where} ORDER BY o.id`,
    )
    .bind(direction.target, linkName, id)
    .all<ObjectRow>();
  return results.map(toObject);
}

// ---- 管理画面用 ----
export type LinkRow = { type: string; from_id: string; to_id: string };

export async function listAllObjects(db: D1Database): Promise<StoredObject[]> {
  const { results } = await db.prepare("SELECT type, id, props FROM objects ORDER BY type, id").all<ObjectRow>();
  return results.map(toObject);
}

export async function listAllLinks(db: D1Database): Promise<LinkRow[]> {
  const { results } = await db
    .prepare("SELECT type, from_id, to_id FROM links ORDER BY type, from_id, to_id")
    .all<LinkRow>();
  return results;
}
