/** mcp/server: インメモリ transport で 5 ツール + 所有者専用ツールを MCP Client から呼ぶ。 */
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RESET_ACTION, createServer, isUserProps } from "../src/mcp/server";
import { recentAudit } from "../src/store/audit";
import { resetSampleData } from "../src/store/seed";

const OWNER = env.OWNER_EMAIL;
const GUEST = "guest@example.com";

async function connect(email: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(env, { email }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type CallResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text?: string }[] };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> =>
  (await client.callTool({ name, arguments: args })) as CallResult;
const text = (r: CallResult): string => r.content[0]?.text ?? "";

/** 入力スキーマ違反は SDK の版によって例外にも isError 結果にもなるので両方を失敗として扱う。 */
async function expectToolFailure(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  const outcome = await call(client, name, args).then(
    (r) => ({ failed: r.isError === true, detail: text(r) }),
    (e: Error) => ({ failed: true, detail: e.message }),
  );
  expect(outcome.failed, outcome.detail).toBe(true);
  expect(outcome.detail).toMatch(/limit/);
}

let clients: Client[] = [];
const open = async (email: string): Promise<Client> => {
  const c = await connect(email);
  clients = [...clients, c];
  return c;
};

beforeEach(async () => {
  await resetSampleData(env.DB);
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
});

describe("tool listing", () => {
  it("exposes the five generic tools to everyone", async () => {
    const names = (await (await open(GUEST)).listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["describe_ontology", "execute_action", "get_object", "search_objects", "traverse"]);
  });

  it("exposes reset_sample_data only to the owner", async () => {
    const names = (await (await open(OWNER)).listTools()).tools.map((t) => t.name);
    expect(names).toContain(RESET_ACTION);
  });

  it("isUserProps guards the auth context shape", () => {
    expect(isUserProps({ email: "a@b" })).toBe(true);
    expect(isUserProps({ email: "" })).toBe(false);
    expect(isUserProps(null)).toBe(false);
    expect(isUserProps("x")).toBe(false);
  });
});

describe("tools", () => {
  it("describe_ontology returns the parsed ontology", async () => {
    const r = await call(await open(GUEST), "describe_ontology");
    const ont = r.structuredContent as { object_types: Record<string, unknown>; link_types: Record<string, { from: string }> };
    expect(Object.keys(ont.object_types)).toEqual(["Customer", "Order", "Product"]);
    expect(ont.link_types.places.from).toBe("Customer");
  });

  it("search_objects filters, validates keys, and bounds limit", async () => {
    const client = await open(GUEST);
    const gold = await call(client, "search_objects", { type: "Customer", filter: { tier: "gold" } });
    expect((gold.structuredContent as { objects: { id: string }[] }).objects.map((o) => o.id)).toEqual(["C001", "C003", "C006"]);

    const two = await call(client, "search_objects", { type: "Order", limit: 2 });
    expect((two.structuredContent as { objects: unknown[] }).objects).toHaveLength(2);

    const bad = await call(client, "search_objects", { type: "Customer", filter: { colour: "red" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toBe("Customer has no property [colour]");

    const unknownType = await call(client, "search_objects", { type: "Invoice" });
    expect(text(unknownType)).toMatch(/unknown object type: Invoice/);

    await expectToolFailure(client, "search_objects", { type: "Order", limit: 0 });
    await expectToolFailure(client, "search_objects", { type: "Order", limit: 501 });
  });

  it("get_object returns the flat object or a not-found error", async () => {
    const client = await open(GUEST);
    const r = await call(client, "get_object", { type: "Order", id: "O1001" });
    expect(r.structuredContent).toEqual({ type: "Order", id: "O1001", amount: 120000, status: "open" });
    const missing = await call(client, "get_object", { type: "Order", id: "O9999" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toBe("Order#O9999 not found");
  });

  it("traverse follows links in both directions", async () => {
    const client = await open(GUEST);
    const fwd = await call(client, "traverse", { type: "Customer", id: "C003", link: "places" });
    expect((fwd.structuredContent as { objects: { id: string }[] }).objects.map((o) => o.id)).toEqual(["O1004", "O1005", "O1023"]);
    const back = await call(client, "traverse", { type: "Order", id: "O1003", link: "places" });
    expect((back.structuredContent as { objects: { id: string }[] }).objects.map((o) => o.id)).toEqual(["C002"]);
    const bad = await call(client, "traverse", { type: "Customer", id: "C001", link: "owns" });
    expect(text(bad)).toMatch(/unknown link type: owns/);
  });

  it("execute_action records the caller's email as actor", async () => {
    const client = await open(GUEST);
    const r = await call(client, "execute_action", { action: "cancel_order", target_id: "O1004", params: { reason: "在庫欠品" } });
    expect(r.structuredContent).toMatchObject({ ok: true, object: { status: "cancelled", note: "在庫欠品" } });
    const [log] = await recentAudit(env.DB);
    expect(log.actor).toBe(GUEST);

    const failed = await call(client, "execute_action", { action: "ship_order", target_id: "O1002" });
    expect(failed.structuredContent).toMatchObject({ ok: false, reason: "precondition_failed" });

    const err = await call(client, "execute_action", { action: "cancel_order", target_id: "O1001" });
    expect(err.isError).toBe(true);
    expect(text(err)).toBe("action cancel_order.reason is required");
  });

  it("reset_sample_data restores the seed and audits the reset", async () => {
    const owner = await open(OWNER);
    await call(owner, "execute_action", { action: "ship_order", target_id: "O1001" });
    const r = await call(owner, "reset_sample_data");
    expect(r.structuredContent).toEqual({ ok: true });
    const shipped = await call(owner, "get_object", { type: "Order", id: "O1001" });
    expect((shipped.structuredContent as { status: string }).status).toBe("open");
    const [log] = await recentAudit(env.DB);
    expect(log).toMatchObject({ actor: OWNER, action: RESET_ACTION, result: "ok" });
  });

  it("guests cannot call reset_sample_data", async () => {
    await expect(call(await open(GUEST), "reset_sample_data")).rejects.toThrow();
  });
});
