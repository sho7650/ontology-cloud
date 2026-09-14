/** ontology/schema + load + validate: スキーマ検証・参照整合性・インスタンス/パラメータ検証。 */
import { describe, expect, it } from "vitest";

import { ONTOLOGY } from "../src/ontology/current";
import { OntologyError, loadOntology } from "../src/ontology/load";
import { type Ontology, OntologySchema, PropertySpecSchema, accepts, actionType, linkType, objectType } from "../src/ontology/schema";
import { validateParams, validateProps } from "../src/ontology/validate";

const BASE = {
  object_types: {
    Customer: {
      key: "customer_id",
      properties: {
        name: { type: "string", required: true },
        tier: { type: "enum", values: ["bronze", "silver", "gold"], required: true },
        score: { type: "number" },
        active: { type: "boolean" },
      },
    },
    Order: {
      properties: {
        amount: { type: "integer", required: true },
        status: { type: "enum", values: ["open", "shipped"], required: true },
        note: { type: "string" },
      },
    },
  },
  link_types: { places: { from: "Customer", to: "Order", cardinality: "one_to_many" } },
  action_types: {
    cancel_order: {
      target: "Order",
      parameters: { reason: { type: "string", required: true } },
      preconditions: [{ property: "status", op: "eq", value: "open" }],
      effects: { status: "shipped", note: "$params.reason" },
    },
    upgrade_tier: { target: "Customer", effects: { tier: "$next_enum" } },
  },
};

// biome-ignore lint/suspicious/noExplicitAny: テスト用に自由に壊す
type Raw = any;
const build = (mutate?: (r: Raw) => void): Raw => {
  const raw = structuredClone(BASE);
  mutate?.(raw);
  return raw;
};
const parse = (raw: Raw): Ontology => OntologySchema.parse(raw);
const errorsOf = (raw: Raw): string => {
  const r = OntologySchema.safeParse(raw);
  return r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
};

describe("loadOntology", () => {
  it("loads the repository ontology.yaml", () => {
    expect(Object.keys(ONTOLOGY.object_types)).toEqual(["Customer", "Order", "Product"]);
    expect(ONTOLOGY.link_types.places.from).toBe("Customer");
    expect(ONTOLOGY.action_types.restock.target).toBe("Product");
  });

  it("rejects invalid YAML", () => {
    expect(() => loadOntology("object_types: [unclosed")).toThrow(OntologyError);
    expect(() => loadOntology("object_types: [unclosed")).toThrow(/not valid YAML/);
  });

  it("rejects a non-mapping top level", () => {
    expect(() => loadOntology("- a\n- b\n")).toThrow(/must be a mapping/);
  });

  it("wraps schema violations with the source name", () => {
    expect(() => loadOntology("object_types:\n  X:\n    properties:\n      a: {type: nope}\n", "x.yaml")).toThrow(
      /invalid ontology x.yaml:\nobject_types.X.properties.a.type/,
    );
  });
});

describe("OntologySchema", () => {
  it("accepts the base ontology and fills defaults", () => {
    const ont = parse(build());
    expect(ont.version).toBe(1);
    expect(ont.link_types.places.cardinality).toBe("one_to_many");
    expect(ont.action_types.upgrade_tier.parameters).toEqual({});
    expect(ont.action_types.upgrade_tier.preconditions).toEqual([]);
  });

  it.each<[string, (r: Raw) => void, RegExp]>([
    ["unknown key", (r) => (r.object_types.Order.colour = "red"), /Unrecognized key/],
    ["unknown property type", (r) => (r.object_types.Order.properties.x = { type: "date" }), /properties.x.type: Invalid option/],
    ["enum without values", (r) => (r.object_types.Order.properties.x = { type: "enum" }), /non-empty/],
    ["duplicate enum values", (r) => (r.object_types.Order.properties.x = { type: "enum", values: ["a", "a"] }), /unique/],
    ["values on non-enum", (r) => (r.object_types.Order.properties.x = { type: "string", values: ["a"] }), /only valid for enum/],
    ["unknown op", (r) => r.action_types.cancel_order.preconditions.push({ property: "status", op: "like", value: "x" }), /preconditions.1.op: Invalid option/],
    ["link to unknown type", (r) => (r.link_types.places.to = "Invoice"), /link_types.places.to: unknown object type 'Invoice'/],
    ["action with unknown target", (r) => (r.action_types.cancel_order.target = "Invoice"), /unknown object type 'Invoice'/],
    [
      "precondition on unknown property",
      (r) => r.action_types.cancel_order.preconditions.push({ property: "colour", op: "eq", value: 1 }),
      /no property 'colour'/,
    ],
    ["effect on unknown property", (r) => (r.action_types.cancel_order.effects.colour = "red"), /no property 'colour'/],
    ["effect referencing undeclared param", (r) => (r.action_types.cancel_order.effects.note = "$params.why"), /undeclared parameter 'why'/],
    [
      "effect param type mismatch",
      (r) => (r.action_types.cancel_order.effects.amount = "$params.reason"),
      /parameter 'reason' is string, property is integer/,
    ],
    [
      "enum param values not a subset",
      (r) => {
        r.action_types.cancel_order.parameters.new_status = { type: "enum", values: ["open", "lost"] };
        r.action_types.cancel_order.effects.status = "$params.new_status";
      },
      /values \[open, lost\] are not a subset of \[open, shipped\]/,
    ],
    ["enum step on non-enum", (r) => (r.action_types.upgrade_tier.effects.name = "$next_enum"), /requires an enum property/],
    ["literal type mismatch", (r) => (r.action_types.cancel_order.effects.amount = "lots"), /violates type integer/],
    ["literal enum value mismatch", (r) => (r.action_types.cancel_order.effects.status = "lost"), /violates type enum/],
  ])("rejects %s", (_name, mutate, pattern) => {
    expect(errorsOf(build(mutate))).toMatch(pattern);
  });

  it("accepts an enum param whose values are a subset", () => {
    const ont = parse(
      build((r) => {
        r.action_types.cancel_order.parameters.new_status = { type: "enum", values: ["shipped"] };
        r.action_types.cancel_order.effects.status = "$params.new_status";
      }),
    );
    expect(ont.action_types.cancel_order.parameters.new_status.values).toEqual(["shipped"]);
  });

  it("reports multiple errors together", () => {
    const errors = errorsOf(
      build((r) => {
        r.link_types.places.to = "Invoice";
        r.action_types.cancel_order.target = "Receipt";
      }),
    );
    expect(errors).toContain("Invoice");
    expect(errors).toContain("Receipt");
  });

  it("lookups report known names", () => {
    const ont = parse(build());
    expect(() => objectType(ont, "Foo")).toThrow("unknown object type: Foo. known: [Customer, Order]");
    expect(() => linkType(ont, "x")).toThrow(/unknown link type: x/);
    expect(() => actionType(ont, "x")).toThrow(/unknown action: x/);
    expect(objectType(ont, "Order").key).toBeUndefined();
  });
});

describe("accepts", () => {
  it.each<[Raw, unknown, boolean]>([
    [{ type: "string" }, "a", true],
    [{ type: "string" }, 1, false],
    [{ type: "integer" }, 1, true],
    [{ type: "integer" }, true, false],
    [{ type: "integer" }, 1.5, false],
    [{ type: "number" }, 1.5, true],
    [{ type: "number" }, 2, true],
    [{ type: "number" }, false, false],
    [{ type: "boolean" }, true, true],
    [{ type: "boolean" }, 1, false],
    [{ type: "enum", values: ["a", "b"] }, "b", true],
    [{ type: "enum", values: ["a", "b"] }, "c", false],
  ])("%j accepts %j → %s", (spec, value, ok) => {
    expect(accepts(PropertySpecSchema.parse(spec), value)).toBe(ok);
  });
});

describe("validateProps / validateParams", () => {
  const ont = parse(build());

  it("accepts a valid full object", () => {
    expect(() => validateProps(ont, "Customer", { name: "a", tier: "gold", score: 1.5, active: true })).not.toThrow();
  });
  it("requires required properties unless partial", () => {
    expect(() => validateProps(ont, "Customer", { tier: "gold" })).toThrow("Customer.name is required");
    expect(() => validateProps(ont, "Customer", { tier: "gold" }, { partial: true })).not.toThrow();
  });
  it("rejects unknown properties", () => {
    expect(() => validateProps(ont, "Customer", { colour: "red" }, { partial: true })).toThrow("Customer has no property [colour]");
  });
  it("rejects type violations", () => {
    expect(() => validateProps(ont, "Customer", { name: "a", tier: "platinum" })).toThrow(
      'Customer.tier="platinum" violates type enum [bronze, silver, gold]',
    );
  });
  it("rejects unknown object types", () => {
    expect(() => validateProps(ont, "Foo", {})).toThrow(/unknown object type: Foo/);
  });
  it("validates action parameters", () => {
    const cancel = actionType(ont, "cancel_order");
    expect(() => validateParams(cancel, "cancel_order", { reason: "oos" })).not.toThrow();
    expect(() => validateParams(cancel, "cancel_order", {})).toThrow("action cancel_order.reason is required");
    expect(() => validateParams(cancel, "cancel_order", { reason: 42 })).toThrow("action cancel_order.reason=42 violates type string");
    expect(() => validateParams(cancel, "cancel_order", { reason: "x", extra: 1 })).toThrow("action cancel_order has no property [extra]");
  });
});
