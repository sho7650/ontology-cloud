"""actions.py: precondition 評価と effect 適用の単体テスト (DB 不要)。"""
from __future__ import annotations

import pytest

from actions import apply_effects, check_conditions
from ontology import Condition, ObjectType

ORDER = ObjectType.model_validate({"properties": {
    "amount": {"type": "integer", "required": True},
    "status": {"type": "enum", "values": ["open", "shipped", "cancelled"], "required": True},
    "note": {"type": "string"},
}})


def cond(property: str, op: str, value) -> Condition:
    return Condition(property=property, op=op, value=value)


@pytest.mark.parametrize("op,value,actual,holds", [
    ("eq", "open", "open", True),
    ("eq", "open", "shipped", False),
    ("ne", "gold", "silver", True),
    ("ne", "gold", "gold", False),
    ("gt", 100, 101, True),
    ("gt", 100, 100, False),
    ("gte", 100, 100, True),
    ("lt", 100, 99, True),
    ("lte", 100, 101, False),
    ("in", ["a", "b"], "b", True),
    ("in", ["a", "b"], "c", False),
    ("contains", "欠品", "在庫欠品", True),
    ("contains", "欠品", "在庫あり", False),
])
def test_ops(op, value, actual, holds):
    assert (check_conditions([cond("p", op, value)], {"p": actual}) == []) is holds


@pytest.mark.parametrize("op,value,actual", [
    ("gt", 100, None),        # 未設定プロパティとの大小比較
    ("gt", 100, "abc"),       # 型違い
    ("contains", "x", 12345), # 文字列でない
    ("in", 5, "x"),           # value がコンテナでない
])
def test_incomparable_counts_as_failed(op, value, actual):
    failed = check_conditions([cond("p", op, value)], {"p": actual})
    assert len(failed) == 1 and "actual" in failed[0]


def test_failed_message_lists_each_condition():
    failed = check_conditions([cond("status", "eq", "open"), cond("amount", "gt", 100)], {"status": "shipped", "amount": 50})
    assert failed == ["status eq 'open' (actual: 'shipped')", "amount gt 100 (actual: 50)"]


def test_empty_conditions():
    assert check_conditions([], {}) == []


def test_apply_literal_and_param():
    before = {"amount": 1, "status": "open"}
    after = apply_effects(ORDER, {"status": "cancelled", "note": "$params.reason"}, before, {"reason": "oos"})
    assert after == {"amount": 1, "status": "cancelled", "note": "oos"}
    assert before == {"amount": 1, "status": "open"}, "入力は変更されない"


def test_apply_absent_optional_param_leaves_property():
    after = apply_effects(ORDER, {"note": "$params.reason"}, {"amount": 1, "status": "open", "note": "keep"}, {})
    assert after["note"] == "keep"


def test_next_enum_and_clamp():
    assert apply_effects(ORDER, {"status": "$next_enum"}, {"status": "open"}, {})["status"] == "shipped"
    assert apply_effects(ORDER, {"status": "$next_enum"}, {"status": "cancelled"}, {})["status"] == "cancelled"


def test_prev_enum_and_clamp():
    assert apply_effects(ORDER, {"status": "$prev_enum"}, {"status": "shipped"}, {})["status"] == "open"
    assert apply_effects(ORDER, {"status": "$prev_enum"}, {"status": "open"}, {})["status"] == "open"


def test_enum_step_without_current_value():
    with pytest.raises(ValueError, match="current value None is not one of"):
        apply_effects(ORDER, {"status": "$next_enum"}, {"amount": 1}, {})
