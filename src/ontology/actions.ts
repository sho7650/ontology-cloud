/**
 * ActionType の precondition 評価と effect 適用 (純粋関数、DB には触らない)。
 */
import { type Condition, ENUM_STEP_EXPRS, type ObjectType, type Op, PARAM_REF_PREFIX, type Props } from "./schema";

const sameKind = (a: unknown, b: unknown): boolean =>
  (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");

/** 比較できない組み合わせ (未設定プロパティに gt など) は「満たさない」として扱う。 */
const OPERATORS: Record<Op, (actual: unknown, expected: unknown) => boolean> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => sameKind(a, b) && (a as number) > (b as number),
  gte: (a, b) => sameKind(a, b) && (a as number) >= (b as number),
  lt: (a, b) => sameKind(a, b) && (a as number) < (b as number),
  lte: (a, b) => sameKind(a, b) && (a as number) <= (b as number),
  in: (a, b) => Array.isArray(b) && b.includes(a),
  contains: (a, b) => typeof a === "string" && typeof b === "string" && a.includes(b),
};

/** 条件を評価し、満たさなかった条件の説明リストを返す (空なら全て OK)。 */
export function checkConditions(conds: readonly Condition[], props: Props): string[] {
  return conds
    .filter((c) => !OPERATORS[c.op](props[c.property], c.value))
    .map((c) => `${c.property} ${c.op} ${JSON.stringify(c.value)} (actual: ${JSON.stringify(props[c.property])})`);
}

/** effect を props に適用した新しいオブジェクトを返す。props は変更しない。 */
export function applyEffects(
  objType: ObjectType,
  effects: Record<string, unknown>,
  props: Props,
  params: Record<string, unknown>,
): Props {
  return Object.entries(effects).reduce<Props>(
    (acc, [prop, expr]) => {
      if (typeof expr === "string" && expr.startsWith(PARAM_REF_PREFIX)) {
        const pname = expr.slice(PARAM_REF_PREFIX.length);
        // 省略された任意パラメータはプロパティを変更しない
        return pname in params ? { ...acc, [prop]: params[pname] as Props[string] } : acc;
      }
      if (typeof expr === "string" && (ENUM_STEP_EXPRS as readonly string[]).includes(expr)) {
        return { ...acc, [prop]: stepEnum(objType.properties[prop]?.values ?? [], props[prop], prop, expr) };
      }
      return { ...acc, [prop]: expr as Props[string] };
    },
    { ...props },
  );
}

function stepEnum(values: readonly string[], current: unknown, prop: string, expr: string): string {
  const i = typeof current === "string" ? values.indexOf(current) : -1;
  if (i < 0) {
    throw new Error(`${expr} on ${prop}: current value ${JSON.stringify(current)} is not one of [${values.join(", ")}]`);
  }
  const next = i + (expr === "$next_enum" ? 1 : -1);
  return values[Math.max(0, Math.min(next, values.length - 1))];
}
