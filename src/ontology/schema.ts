/**
 * ontology.yaml のスキーマ定義と参照整合性の検証 (zod)。
 *
 * 不正な定義は実行時ではなく起動時 (モジュールロード時) に落とす。
 */
import { z } from "zod";

export const PROP_TYPES = ["string", "integer", "number", "boolean", "enum"] as const;
export const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"] as const;
export const CARDINALITIES = ["one_to_one", "one_to_many", "many_to_one", "many_to_many"] as const;
export const PARAM_REF_PREFIX = "$params.";
export const ENUM_STEP_EXPRS = ["$next_enum", "$prev_enum"] as const;

export type PropType = (typeof PROP_TYPES)[number];
export type Op = (typeof OPS)[number];
export type Json = string | number | boolean | null;
export type Props = Record<string, Json>;

export const PropertySpecSchema = z
  .strictObject({
    type: z.enum(PROP_TYPES),
    required: z.boolean().default(false),
    values: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.type === "enum") {
      if (!spec.values || spec.values.length === 0) {
        ctx.addIssue({ code: "custom", message: "enum requires a non-empty 'values' list" });
      } else if (new Set(spec.values).size !== spec.values.length) {
        ctx.addIssue({ code: "custom", message: `enum values must be unique: [${spec.values.join(", ")}]` });
      }
    } else if (spec.values !== undefined) {
      ctx.addIssue({ code: "custom", message: `'values' is only valid for enum, not ${spec.type}` });
    }
  });
export type PropertySpec = z.infer<typeof PropertySpecSchema>;

export const ObjectTypeSchema = z.strictObject({
  description: z.string().optional(),
  key: z.string().optional(),
  properties: z.record(z.string(), PropertySpecSchema).default({}),
});
export type ObjectType = z.infer<typeof ObjectTypeSchema>;

export const LinkTypeSchema = z.strictObject({
  description: z.string().optional(),
  from: z.string(),
  to: z.string(),
  cardinality: z.enum(CARDINALITIES).default("many_to_many"),
});
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const ConditionSchema = z.strictObject({
  property: z.string(),
  op: z.enum(OPS),
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionTypeSchema = z.strictObject({
  description: z.string().optional(),
  target: z.string(),
  parameters: z.record(z.string(), PropertySpecSchema).default({}),
  preconditions: z.array(ConditionSchema).default([]),
  effects: z.record(z.string(), z.unknown()).default({}),
});
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const OntologySchema = z
  .strictObject({
    version: z.number().int().default(1),
    object_types: z.record(z.string(), ObjectTypeSchema),
    link_types: z.record(z.string(), LinkTypeSchema).default({}),
    action_types: z.record(z.string(), ActionTypeSchema).default({}),
  })
  .superRefine((ont, ctx) => {
    for (const message of [...linkErrors(ont), ...actionErrors(ont)]) {
      ctx.addIssue({ code: "custom", message });
    }
  });
export type Ontology = z.infer<typeof OntologySchema>;

type RawOntology = z.input<typeof OntologySchema> & z.output<typeof OntologySchema>;

function linkErrors(ont: RawOntology): string[] {
  return Object.entries(ont.link_types).flatMap(([name, lt]) =>
    (["from", "to"] as const)
      .filter((side) => !(lt[side] in ont.object_types))
      .map((side) => `link_types.${name}.${side}: unknown object type '${lt[side]}'`),
  );
}

function actionErrors(ont: RawOntology): string[] {
  return Object.entries(ont.action_types).flatMap(([name, at]) => {
    const target = ont.object_types[at.target];
    if (!target) return [`action_types.${name}.target: unknown object type '${at.target}'`];
    const preconditionErrors = at.preconditions
      .filter((c) => !(c.property in target.properties))
      .map((c) => `action_types.${name}.preconditions: ${at.target} has no property '${c.property}'`);
    const effectErrors = Object.entries(at.effects).flatMap(([prop, expr]) =>
      effectErrorsFor(`action_types.${name}.effects.${prop}`, at, target, prop, expr),
    );
    return [...preconditionErrors, ...effectErrors];
  });
}

function effectErrorsFor(where: string, at: ActionType, target: ObjectType, prop: string, expr: unknown): string[] {
  const spec = target.properties[prop];
  if (!spec) return [`${where}: ${at.target} has no property '${prop}'`];
  if (typeof expr === "string" && expr.startsWith(PARAM_REF_PREFIX)) {
    const pname = expr.slice(PARAM_REF_PREFIX.length);
    const param = at.parameters[pname];
    if (!param) return [`${where}: references undeclared parameter '${pname}'`];
    if (param.type !== spec.type) return [`${where}: parameter '${pname}' is ${param.type}, property is ${spec.type}`];
    if (spec.type === "enum" && !(param.values ?? []).every((v) => (spec.values ?? []).includes(v))) {
      return [`${where}: parameter '${pname}' values [${param.values?.join(", ")}] are not a subset of [${spec.values?.join(", ")}]`];
    }
    return [];
  }
  if (typeof expr === "string" && (ENUM_STEP_EXPRS as readonly string[]).includes(expr)) {
    return spec.type === "enum" ? [] : [`${where}: ${expr} requires an enum property, '${prop}' is ${spec.type}`];
  }
  return accepts(spec, expr) ? [] : [`${where}: literal ${JSON.stringify(expr)} violates type ${describeType(spec)}`];
}

/** 値がこの宣言の型に合うか。boolean は integer / number として扱わない。 */
export function accepts(spec: PropertySpec, value: unknown): boolean {
  switch (spec.type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && (spec.values ?? []).includes(value);
  }
}

export function describeType(spec: PropertySpec): string {
  return spec.type === "enum" ? `enum [${(spec.values ?? []).join(", ")}]` : spec.type;
}

function lookup<T>(table: Record<string, T>, name: string, kind: string): T {
  const found = table[name];
  if (found === undefined) {
    throw new Error(`unknown ${kind}: ${name}. known: [${Object.keys(table).join(", ")}]`);
  }
  return found;
}

export const objectType = (ont: Ontology, name: string): ObjectType => lookup(ont.object_types, name, "object type");
export const linkType = (ont: Ontology, name: string): LinkType => lookup(ont.link_types, name, "link type");
export const actionType = (ont: Ontology, name: string): ActionType => lookup(ont.action_types, name, "action");
