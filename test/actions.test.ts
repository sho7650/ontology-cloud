/** ontology/actions: precondition 評価と effect 適用 (DB 不要)。 */
import { describe, expect, it } from "vitest";

import { applyEffects, checkConditions } from "../src/ontology/actions";
import { type Condition, ObjectTypeSchema, type Op } from "../src/ontology/schema";

const ORDER = ObjectTypeSchema.parse({
  properties: {
    amount: { type: "integer", required: true },
    status: { type: "enum", values: ["open", "shipped", "cancelled"], required: true },
    note: { type: "string" },
  },
});

const cond = (property: string, op: Op, value: unknown): Condition => ({ property, op, value });

describe("checkConditions", () => {
  it.each<[Op, unknown, unknown, boolean]>([
    ["eq", "open", "open", true],
    ["eq", "open", "shipped", false],
    ["ne", "gold", "silver", true],
    ["ne", "gold", "gold", false],
    ["gt", 100, 101, true],
    ["gt", 100, 100, false],
    ["gte", 100, 100, true],
    ["lt", 100, 99, true],
    ["lte", 100, 101, false],
    ["in", ["a", "b"], "b", true],
    ["in", ["a", "b"], "c", false],
    ["contains", "欠品", "在庫欠品", true],
    ["contains", "欠品", "在庫あり", false],
  ])("%s %j against %j → %s", (op, value, actual, holds) => {
    expect(checkConditions([cond("p", op, value)], { p: actual as never }).length === 0).toBe(holds);
  });

  it.each<[Op, unknown, unknown]>([
    ["gt", 100, null], // 未設定プロパティとの大小比較
    ["gt", 100, "abc"], // 型違い
    ["contains", "x", 12345], // 文字列でない
    ["in", 5, "x"], // value がコンテナでない
  ])("treats incomparable %s as failed", (op, value, actual) => {
    const failed = checkConditions([cond("p", op, value)], { p: actual as never });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("actual");
  });

  it("describes each failed condition", () => {
    expect(checkConditions([cond("status", "eq", "open"), cond("amount", "gt", 100)], { status: "shipped", amount: 50 })).toEqual([
      'status eq "open" (actual: "shipped")',
      "amount gt 100 (actual: 50)",
    ]);
  });

  it("passes with no conditions", () => {
    expect(checkConditions([], {})).toEqual([]);
  });
});

describe("applyEffects", () => {
  it("applies literals and $params without mutating the input", () => {
    const before = { amount: 1, status: "open" };
    const after = applyEffects(ORDER, { status: "cancelled", note: "$params.reason" }, before, { reason: "oos" });
    expect(after).toEqual({ amount: 1, status: "cancelled", note: "oos" });
    expect(before).toEqual({ amount: 1, status: "open" });
  });

  it("leaves the property unchanged when an optional param is absent", () => {
    expect(applyEffects(ORDER, { note: "$params.reason" }, { amount: 1, status: "open", note: "keep" }, {}).note).toBe("keep");
  });

  it("steps enums forward and clamps at the end", () => {
    expect(applyEffects(ORDER, { status: "$next_enum" }, { status: "open" }, {}).status).toBe("shipped");
    expect(applyEffects(ORDER, { status: "$next_enum" }, { status: "cancelled" }, {}).status).toBe("cancelled");
  });

  it("steps enums backward and clamps at the start", () => {
    expect(applyEffects(ORDER, { status: "$prev_enum" }, { status: "shipped" }, {}).status).toBe("open");
    expect(applyEffects(ORDER, { status: "$prev_enum" }, { status: "open" }, {}).status).toBe("open");
  });

  it("fails when the current enum value is missing or invalid", () => {
    expect(() => applyEffects(ORDER, { status: "$next_enum" }, { amount: 1 }, {})).toThrow(
      "$next_enum on status: current value undefined is not one of [open, shipped, cancelled]",
    );
  });
});
