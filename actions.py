"""
ActionType の precondition 評価と effect 適用 (純粋関数、DB には触らない)。
"""
from __future__ import annotations

from typing import Any, Callable

from ontology import ENUM_STEP_EXPRS, PARAM_REF_PREFIX, Condition, ObjectType

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "gt": lambda a, b: a > b,
    "gte": lambda a, b: a >= b,
    "lt": lambda a, b: a < b,
    "lte": lambda a, b: a <= b,
    "in": lambda a, b: a in b,
    "contains": lambda a, b: isinstance(a, str) and b in a,
}


def _holds(op: str, actual: Any, expected: Any) -> bool:
    """比較できない組み合わせ (None > 5 など) は「満たさない」として扱う。"""
    try:
        return bool(_OPS[op](actual, expected))
    except TypeError:
        return False


def check_conditions(conds: list[Condition], props: dict) -> list[str]:
    """条件を評価し、満たさなかった条件の説明リストを返す (空なら全て OK)。"""
    return [
        f"{c.property} {c.op} {c.value!r} (actual: {props.get(c.property)!r})"
        for c in conds
        if not _holds(c.op, props.get(c.property), c.value)
    ]


def apply_effects(obj_type: ObjectType, effects: dict[str, Any], props: dict, params: dict) -> dict:
    """effect を props に適用した新しい dict を返す。props は変更しない。"""
    new = dict(props)
    for prop, expr in effects.items():
        if isinstance(expr, str) and expr.startswith(PARAM_REF_PREFIX):
            pname = expr[len(PARAM_REF_PREFIX):]
            if pname in params:  # 省略された任意パラメータはプロパティを変更しない
                new[prop] = params[pname]
        elif isinstance(expr, str) and expr in ENUM_STEP_EXPRS:
            new[prop] = _step_enum(obj_type.properties[prop].values or [], props.get(prop), prop, expr)
        else:
            new[prop] = expr
    return new


def _step_enum(values: list[str], current: Any, prop: str, expr: str) -> str:
    if current not in values:
        raise ValueError(f"{expr} on {prop}: current value {current!r} is not one of {values}")
    i = values.index(current) + (1 if expr == "$next_enum" else -1)
    return values[max(0, min(i, len(values) - 1))]
