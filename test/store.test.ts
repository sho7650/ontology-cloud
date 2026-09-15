/** store/*: D1 (Miniflare) に対する検索・トラバース・アクション実行・楽観ロック・監査。 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { ONTOLOGY } from "../src/ontology/current";
import { linkType } from "../src/ontology/schema";
import { executeAction } from "../src/store/actions";
import { type AuditRow, recentAudit } from "../src/store/audit";
import { getObject, listAllLinks, listAllObjects, searchObjects, traverse } from "../src/store/objects";
import { SEED_LINKS, SEED_OBJECTS, chunk, resetSampleData } from "../src/store/seed";

const db = env.DB;
const ACTOR = "tester@example.com";
const audit = (): Promise<AuditRow[]> => recentAudit(db);

beforeEach(async () => {
  await resetSampleData(db);
});

describe("resetSampleData", () => {
  it("loads all seed rows and is idempotent", async () => {
    expect(await listAllObjects(db)).toHaveLength(SEED_OBJECTS.length);
    expect(await listAllLinks(db)).toHaveLength(SEED_LINKS.length);
    await resetSampleData(db);
    expect(await listAllObjects(db)).toHaveLength(SEED_OBJECTS.length);
    expect(await audit()).toEqual([]);
  });

  it("keeps the README example rows", async () => {
    expect((await getObject(db, "Order", "O1001"))?.props).toEqual({ amount: 120000, status: "open" });
    expect((await getObject(db, "Order", "O1002"))?.props.status).toBe("shipped");
    expect((await getObject(db, "Order", "O1005"))?.props.status).toBe("cancelled");
    expect((await getObject(db, "Customer", "C002"))?.props.tier).toBe("silver");
  });

  it("chunk splits without losing items", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("searchObjects", () => {
  it("filters by exact property match", async () => {
    const gold = await searchObjects(db, "Customer", { tier: "gold" }, 50);
    expect(gold.map((o) => o.id)).toEqual(["C001", "C003", "C006"]);
    expect(gold[0].props.name).toBe("山田商事");
  });

  it("ANDs multiple keys and honours limit", async () => {
    const open = await searchObjects(db, "Order", { status: "open" }, 500);
    expect(open.length).toBeGreaterThan(5);
    expect(await searchObjects(db, "Order", { status: "open", amount: 120000 }, 50)).toHaveLength(1);
    expect(await searchObjects(db, "Order", {}, 2)).toHaveLength(2);
  });

  it("matches boolean values stored as JSON true/false", async () => {
    await db.prepare("INSERT INTO objects (type, id, props) VALUES ('Flag', 'F1', '{\"on\":true}'), ('Flag', 'F2', '{\"on\":false}')").run();
    expect((await searchObjects(db, "Flag", { on: true }, 10)).map((o) => o.id)).toEqual(["F1"]);
    expect((await searchObjects(db, "Flag", { on: false }, 10)).map((o) => o.id)).toEqual(["F2"]);
  });

  it("rejects filter keys that are not identifiers", async () => {
    await expect(searchObjects(db, "Order", { "a\"b": 1 }, 10)).rejects.toThrow(/invalid filter key/);
  });
});

describe("getObject / traverse", () => {
  it("returns null for a missing object", async () => {
    expect(await getObject(db, "Order", "O9999")).toBeNull();
  });

  it("traverses forward and backward", async () => {
    const places = linkType(ONTOLOGY, "places");
    expect((await traverse(db, "places", places, "Customer", "C001", )).map((o) => o.id)).toEqual(["O1001", "O1002", "O1014", "O1024"]);
    expect((await traverse(db, "places", places, "Order", "O1003")).map((o) => o.id)).toEqual(["C002"]);
    const contains = linkType(ONTOLOGY, "contains");
    expect((await traverse(db, "contains", contains, "Order", "O1001")).map((o) => o.type)).toEqual(["Product", "Product"]);
  });

  it("rejects a type the link does not connect", async () => {
    await expect(traverse(db, "places", linkType(ONTOLOGY, "places"), "Product", "P001")).rejects.toThrow(
      "link places does not connect Product (Customer -> Order)",
    );
  });
});

describe("executeAction", () => {
  it("applies effects and writes an ok audit row", async () => {
    const r = await executeAction(db, ONTOLOGY, ACTOR, "ship_order", "O1001", {});
    expect(r).toEqual({ ok: true, object: { type: "Order", id: "O1001", amount: 120000, status: "shipped" } });
    expect((await getObject(db, "Order", "O1001"))?.props.status).toBe("shipped");
    const [log] = await audit();
    expect(log).toMatchObject({ actor: ACTOR, action: "ship_order", target_type: "Order", target_id: "O1001", result: "ok", error: null });
    expect(JSON.parse(log.before ?? "")).toEqual({ amount: 120000, status: "open" });
    expect(JSON.parse(log.after ?? "")).toEqual({ amount: 120000, status: "shipped" });
  });

  it("passes parameters into effects", async () => {
    const r = await executeAction(db, ONTOLOGY, ACTOR, "cancel_order", "O1004", { reason: "在庫欠品" });
    expect(r.object).toEqual({ type: "Order", id: "O1004", amount: 80000, status: "cancelled", note: "在庫欠品" });
  });

  it("reports precondition failures without changing the object", async () => {
    const r = await executeAction(db, ONTOLOGY, ACTOR, "ship_order", "O1002", {});
    expect(r).toMatchObject({ ok: false, reason: "precondition_failed", failed: ['status eq "open" (actual: "shipped")'] });
    const [log] = await audit();
    expect(log.result).toBe("precondition_failed");
    expect(log.after).toBeNull();
  });

  it("steps enums via $next_enum and restocks products", async () => {
    expect((await executeAction(db, ONTOLOGY, ACTOR, "upgrade_tier", "C002", {})).object.tier).toBe("gold");
    expect((await executeAction(db, ONTOLOGY, ACTOR, "upgrade_tier", "C002", {})).ok).toBe(false);
    expect((await executeAction(db, ONTOLOGY, ACTOR, "restock", "P001", {})).object.stock).toBe(100);
    expect((await executeAction(db, ONTOLOGY, ACTOR, "restock", "P002", {})).ok).toBe(false);
  });

  it("logs parameter errors with result=error and leaves the object untouched", async () => {
    await expect(executeAction(db, ONTOLOGY, ACTOR, "cancel_order", "O1001", {})).rejects.toThrow("action cancel_order.reason is required");
    await expect(executeAction(db, ONTOLOGY, ACTOR, "cancel_order", "O1001", { reason: 42 })).rejects.toThrow(/violates type string/);
    const rows = await audit();
    expect(rows.map((r) => r.result)).toEqual(["error", "error"]);
    expect(rows[1].error).toBe("Error: action cancel_order.reason is required");
    expect(rows[1].before).toBeNull();
    expect((await getObject(db, "Order", "O1001"))?.props.status).toBe("open");
  });

  it("logs not-found as error and keeps before when the failure happens after the fetch", async () => {
    await expect(executeAction(db, ONTOLOGY, ACTOR, "ship_order", "O9999", {})).rejects.toThrow("Order#O9999 not found");
    await db.prepare("UPDATE objects SET props = '{\"name\":\"x\",\"tier\":\"platinum\"}' WHERE type = 'Customer' AND id = 'C001'").run();
    await expect(executeAction(db, ONTOLOGY, ACTOR, "upgrade_tier", "C001", {})).rejects.toThrow(/current value "platinum" is not one of/);
    const [withBefore, notFound] = await audit();
    expect(notFound).toMatchObject({ result: "error", before: null });
    expect(JSON.parse(withBefore.before ?? "")).toEqual({ name: "x", tier: "platinum" });
  });

  it("does not audit unknown actions", async () => {
    await expect(executeAction(db, ONTOLOGY, ACTOR, "explode", "O1001", {})).rejects.toThrow(/unknown action: explode/);
    expect(await audit()).toEqual([]);
  });

  it("retries once when another writer changes the row in between", async () => {
    const interfering = withInterference(db, 1);
    const r = await executeAction(interfering, ONTOLOGY, ACTOR, "ship_order", "O1001", {});
    expect(r).toMatchObject({ ok: true, object: { status: "shipped", note: "interfered-1" } });
    expect((await audit()).map((a) => a.result)).toEqual(["ok"]);
  });

  it("gives up after repeated conflicts and logs an error", async () => {
    const interfering = withInterference(db, Number.POSITIVE_INFINITY);
    await expect(executeAction(interfering, ONTOLOGY, ACTOR, "ship_order", "O1001", {})).rejects.toThrow(/modified concurrently/);
    const [log] = await audit();
    expect(log.result).toBe("error");
    expect((await getObject(db, "Order", "O1001"))?.props.status).toBe("open");
  });
});

/** batch() の直前に別の書き込みを挟む D1 ラッパー (最初の n 回だけ、毎回異なる値にする)。 */
function withInterference(real: D1Database, times: number): D1Database {
  let count = 0;
  const batch: D1Database["batch"] = async (statements) => {
    if (count < times) {
      count += 1;
      await real
        .prepare("UPDATE objects SET props = json_set(props, '$.note', ?) WHERE type = 'Order' AND id = 'O1001'")
        .bind(`interfered-${count}`)
        .run();
    }
    return real.batch(statements);
  };
  return new Proxy(real, {
    get: (target, prop, receiver) => (prop === "batch" ? batch : Reflect.get(target, prop, receiver)),
  });
}

describe("ensureSchema", () => {
  it("splits the migration into statements without comments", async () => {
    const { splitStatements } = await import("../src/store/schema");
    const stmts = splitStatements("-- c\nCREATE TABLE IF NOT EXISTS a (x INT);\n\n-- d\nCREATE INDEX IF NOT EXISTS i ON a (x);\n");
    expect(stmts).toEqual(["CREATE TABLE IF NOT EXISTS a (x INT)", "CREATE INDEX IF NOT EXISTS i ON a (x)"]);
  });

  it("is idempotent on an already-migrated database", async () => {
    const { ensureSchema } = await import("../src/store/schema");
    await ensureSchema(db);
    await ensureSchema(db);
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('objects','links','audit_log') ORDER BY name").all<{ name: string }>();
    expect(tables.results.map((t) => t.name)).toEqual(["audit_log", "links", "objects"]);
    expect(await listAllObjects(db)).toHaveLength(SEED_OBJECTS.length);
  });
});
