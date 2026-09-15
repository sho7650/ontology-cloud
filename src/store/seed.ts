/**
 * サンプルデータの定義とリセット。
 * scripts/seed-sql.ts も同じ配列から seed.sql を生成するので、データはここだけで管理する。
 */
import type { Props } from "../ontology/schema";
import { ensureSchema } from "./schema";

export type SeedObject = { type: string; id: string; props: Props };
export type SeedLink = { type: string; from: string; to: string };

const customers: SeedObject[] = (
  [
    ["C001", "山田商事", "gold", "yamada@example.com"],
    ["C002", "佐藤工業", "silver", "sato@example.com"],
    ["C003", "鈴木製作所", "gold", "suzuki@example.com"],
    ["C004", "高橋商店", "bronze", "takahashi@example.com"],
    ["C005", "田中電機", "silver", "tanaka@example.com"],
    ["C006", "伊藤物産", "gold", "ito@example.com"],
    ["C007", "渡辺建設", "bronze", "watanabe@example.com"],
    ["C008", "中村精密", "silver", "nakamura@example.com"],
    ["C009", "小林運輸", "bronze", "kobayashi@example.com"],
    ["C010", "加藤化学", "silver", "kato@example.com"],
  ] as const
).map(([id, name, tier, email]) => ({ type: "Customer", id, props: { name, tier, email } }));

// [注文 ID, 顧客 ID, 金額, 状態]。先頭 5 件は README のプロンプト例が前提にしているので変更しない。
const orderRows = [
  ["O1001", "C001", 120000, "open"],
  ["O1002", "C001", 45000, "shipped"],
  ["O1003", "C002", 300000, "open"],
  ["O1004", "C003", 80000, "open"],
  ["O1005", "C003", 15000, "cancelled"],
  ["O1006", "C004", 22000, "open"],
  ["O1007", "C005", 98000, "shipped"],
  ["O1008", "C006", 450000, "open"],
  ["O1009", "C006", 130000, "shipped"],
  ["O1010", "C007", 18000, "cancelled"],
  ["O1011", "C008", 76000, "open"],
  ["O1012", "C009", 33000, "shipped"],
  ["O1013", "C010", 210000, "open"],
  ["O1014", "C001", 64000, "shipped"],
  ["O1015", "C002", 27000, "cancelled"],
  ["O1016", "C004", 150000, "open"],
  ["O1017", "C005", 41000, "open"],
  ["O1018", "C006", 88000, "shipped"],
  ["O1019", "C007", 12000, "open"],
  ["O1020", "C008", 500000, "shipped"],
  ["O1021", "C009", 59000, "open"],
  ["O1022", "C010", 36000, "shipped"],
  ["O1023", "C003", 240000, "open"],
  ["O1024", "C001", 19000, "cancelled"],
  ["O1025", "C005", 175000, "shipped"],
  ["O1026", "C008", 28000, "open"],
  ["O1027", "C002", 66000, "shipped"],
  ["O1028", "C006", 310000, "open"],
  ["O1029", "C010", 14000, "open"],
  ["O1030", "C004", 92000, "shipped"],
] as const;

const orders: SeedObject[] = orderRows.map(([id, , amount, status]) => ({ type: "Order", id, props: { amount, status } }));
const places: SeedLink[] = orderRows.map(([id, customer]) => ({ type: "places", from: customer, to: id }));

// 在庫 10 未満 (P001, P004, P006) は restock の前提条件を満たすデモ用
const products: SeedObject[] = (
  [
    ["P001", "ボルト M8", "parts", 3, 120],
    ["P002", "ナット M8", "parts", 250, 80],
    ["P003", "電動ドリル", "tools", 12, 18000],
    ["P004", "トルクレンチ", "tools", 6, 24000],
    ["P005", "潤滑油 1L", "consumables", 40, 1500],
    ["P006", "研磨パッド", "consumables", 8, 600],
    ["P007", "ベアリング 6204", "parts", 75, 900],
    ["P008", "安全手袋", "consumables", 120, 400],
  ] as const
).map(([id, name, category, stock, price]) => ({ type: "Product", id, props: { name, stock, price, category } }));

// 各注文に商品 1〜2 点を決定的に割り当てる (偶数番目の注文は 2 点)
const contains: SeedLink[] = orderRows.flatMap(([id], i) => {
  const first = (i % products.length) + 1;
  const second = ((i * 5 + 3) % products.length) + 1;
  const picks = i % 2 === 0 && second !== first ? [first, second] : [first];
  return picks.map((n) => ({ type: "contains", from: id, to: `P${String(n).padStart(3, "0")}` }));
});

export const SEED_OBJECTS: readonly SeedObject[] = [...customers, ...orders, ...products];
export const SEED_LINKS: readonly SeedLink[] = [...places, ...contains];

/** 1 文あたりの bind 上限 (D1 は 100) を超えないよう、3 列 × 30 行ずつに分ける。 */
const ROWS_PER_STATEMENT = 30;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

function insertObjects(db: D1Database, rows: readonly SeedObject[]): D1PreparedStatement {
  const placeholders = rows.map(() => "(?, ?, ?)").join(", ");
  return db
    .prepare(`INSERT INTO objects (type, id, props) VALUES ${placeholders}`)
    .bind(...rows.flatMap((o) => [o.type, o.id, JSON.stringify(o.props)]));
}

function insertLinks(db: D1Database, rows: readonly SeedLink[]): D1PreparedStatement {
  const placeholders = rows.map(() => "(?, ?, ?)").join(", ");
  return db
    .prepare(`INSERT INTO links (type, from_id, to_id) VALUES ${placeholders}`)
    .bind(...rows.flatMap((l) => [l.type, l.from, l.to]));
}

/**
 * 全テーブルを空にしてサンプルデータを入れ直す (1 バッチ = 1 トランザクション)。
 * 先にテーブルが無ければ作るので、wrangler を使わないデプロイ (ダッシュボードの GitHub 連携) でも
 * /admin のリセットだけで初期化が完了する。
 */
export async function resetSampleData(db: D1Database): Promise<void> {
  await ensureSchema(db);
  await db.batch([
    db.prepare("DELETE FROM links"),
    db.prepare("DELETE FROM objects"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit_log'"),
    ...chunk(SEED_OBJECTS, ROWS_PER_STATEMENT).map((rows) => insertObjects(db, rows)),
    ...chunk(SEED_LINKS, ROWS_PER_STATEMENT).map((rows) => insertLinks(db, rows)),
  ]);
}
