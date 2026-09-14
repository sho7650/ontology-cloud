/**
 * インスタンスのプロパティ / アクションのパラメータが宣言に合っているかの検証。
 */
import { type ActionType, type Ontology, type PropertySpec, accepts, describeType, objectType } from "./schema";

export function validateProps(
  ont: Ontology,
  typeName: string,
  props: Record<string, unknown>,
  options: { partial?: boolean } = {},
): void {
  validateValues(objectType(ont, typeName).properties, props, typeName, options.partial ?? false);
}

export function validateParams(action: ActionType, actionName: string, params: Record<string, unknown>): void {
  validateValues(action.parameters, params, `action ${actionName}`, false);
}

function validateValues(
  spec: Record<string, PropertySpec>,
  values: Record<string, unknown>,
  owner: string,
  partial: boolean,
): void {
  const unknown = Object.keys(values).filter((k) => !(k in spec)).sort();
  if (unknown.length) throw new Error(`${owner} has no property [${unknown.join(", ")}]`);
  for (const [name, rule] of Object.entries(spec)) {
    if (!(name in values)) {
      if (rule.required && !partial) throw new Error(`${owner}.${name} is required`);
      continue;
    }
    if (!accepts(rule, values[name])) {
      throw new Error(`${owner}.${name}=${JSON.stringify(values[name])} violates type ${describeType(rule)}`);
    }
  }
}
