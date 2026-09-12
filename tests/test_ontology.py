"""ontology.py: スキーマ検証・参照整合性・インスタンス/パラメータ検証の単体テスト。"""
from __future__ import annotations

import copy
from pathlib import Path

import pytest

from ontology import Ontology, OntologyError, PropertySpec, load_ontology, validate_params, validate_props

ROOT = Path(__file__).resolve().parent.parent

BASE = {
    "object_types": {
        "Customer": {"key": "customer_id", "properties": {
            "name": {"type": "string", "required": True},
            "tier": {"type": "enum", "values": ["bronze", "silver", "gold"], "required": True},
            "score": {"type": "number"},
            "active": {"type": "boolean"},
        }},
        "Order": {"properties": {
            "amount": {"type": "integer", "required": True},
            "status": {"type": "enum", "values": ["open", "shipped"], "required": True},
            "note": {"type": "string"},
        }},
    },
    "link_types": {"places": {"from": "Customer", "to": "Order", "cardinality": "one_to_many"}},
    "action_types": {
        "cancel_order": {
            "target": "Order",
            "parameters": {"reason": {"type": "string", "required": True}},
            "preconditions": [{"property": "status", "op": "eq", "value": "open"}],
            "effects": {"status": "shipped", "note": "$params.reason"},
        },
        "upgrade_tier": {"target": "Customer", "effects": {"tier": "$next_enum"}},
    },
}


def build(mutate=None) -> dict:
    raw = copy.deepcopy(BASE)
    if mutate:
        mutate(raw)
    return raw


def assert_invalid(mutate, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        Ontology.model_validate(build(mutate))


# ------------------------------------------------------------ loading
def test_repo_ontology_loads():
    ont = load_ontology(ROOT / "ontology.yaml")
    assert set(ont.object_types) == {"Customer", "Order"}
    assert ont.link_types["places"].from_ == "Customer"
    assert ont.to_dict()["link_types"]["places"]["from"] == "Customer"


def test_missing_file(tmp_path):
    with pytest.raises(OntologyError, match="not found"):
        load_ontology(tmp_path / "nope.yaml")


def test_invalid_yaml(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("object_types: [unclosed", encoding="utf-8")
    with pytest.raises(OntologyError, match="not valid YAML"):
        load_ontology(p)


def test_top_level_not_mapping(tmp_path):
    p = tmp_path / "list.yaml"
    p.write_text("- a\n- b\n", encoding="utf-8")
    with pytest.raises(OntologyError, match="mapping"):
        load_ontology(p)


def test_schema_violation_wrapped(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("object_types:\n  X:\n    properties:\n      a: {type: nope}\n", encoding="utf-8")
    with pytest.raises(OntologyError, match="invalid ontology"):
        load_ontology(p)


# ------------------------------------------------------- schema rules
def test_valid_base():
    ont = Ontology.model_validate(build())
    assert ont.action_type("cancel_order").target == "Order"


def test_unknown_key_rejected():
    assert_invalid(lambda r: r["object_types"]["Order"].update(colour="red"), "Extra inputs")


def test_unknown_property_type():
    assert_invalid(lambda r: r["object_types"]["Order"]["properties"].update(x={"type": "date"}), "date")


def test_enum_requires_values():
    assert_invalid(lambda r: r["object_types"]["Order"]["properties"].update(x={"type": "enum"}), "non-empty")


def test_enum_values_unique():
    assert_invalid(lambda r: r["object_types"]["Order"]["properties"].update(x={"type": "enum", "values": ["a", "a"]}), "unique")


def test_values_only_for_enum():
    assert_invalid(lambda r: r["object_types"]["Order"]["properties"].update(x={"type": "string", "values": ["a"]}), "only valid for enum")


def test_unknown_op():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["preconditions"].append({"property": "status", "op": "like", "value": "x"}), "like")


def test_link_unknown_type():
    assert_invalid(lambda r: r["link_types"]["places"].update(to="Invoice"), "link_types.places.to: unknown object type 'Invoice'")


def test_action_unknown_target():
    assert_invalid(lambda r: r["action_types"]["cancel_order"].update(target="Invoice"), "unknown object type 'Invoice'")


def test_precondition_unknown_property():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["preconditions"].append({"property": "colour", "op": "eq", "value": 1}), "no property 'colour'")


def test_effect_unknown_property():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["effects"].update(colour="red"), "no property 'colour'")


def test_effect_undeclared_param():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["effects"].update(note="$params.why"), "undeclared parameter 'why'")


def test_effect_param_type_mismatch():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["effects"].update(amount="$params.reason"), "parameter 'reason' is string, property is integer")


def test_effect_enum_step_on_non_enum():
    assert_invalid(lambda r: r["action_types"]["upgrade_tier"]["effects"].update(name="$next_enum"), "requires an enum property")


def test_effect_literal_type_mismatch():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["effects"].update(amount="lots"), "violates type integer")


def test_effect_literal_enum_value_mismatch():
    assert_invalid(lambda r: r["action_types"]["cancel_order"]["effects"].update(status="lost"), "violates type enum")


def test_multiple_errors_reported_together():
    def mutate(r):
        r["link_types"]["places"]["to"] = "Invoice"
        r["action_types"]["cancel_order"]["target"] = "Receipt"
    with pytest.raises(ValueError) as e:
        Ontology.model_validate(build(mutate))
    assert "Invoice" in str(e.value) and "Receipt" in str(e.value)


def test_lookup_unknown_names():
    ont = Ontology.model_validate(build())
    with pytest.raises(ValueError, match="unknown object type: Foo. known: \\['Customer', 'Order'\\]"):
        ont.object_type("Foo")
    with pytest.raises(ValueError, match="unknown link type: x"):
        ont.link_type("x")
    with pytest.raises(ValueError, match="unknown action: x"):
        ont.action_type("x")


# ------------------------------------------------- PropertySpec.accepts
@pytest.mark.parametrize("spec,value,ok", [
    ({"type": "string"}, "a", True),
    ({"type": "string"}, 1, False),
    ({"type": "integer"}, 1, True),
    ({"type": "integer"}, True, False),
    ({"type": "integer"}, 1.5, False),
    ({"type": "number"}, 1.5, True),
    ({"type": "number"}, 2, True),
    ({"type": "number"}, False, False),
    ({"type": "boolean"}, True, True),
    ({"type": "boolean"}, 1, False),
    ({"type": "enum", "values": ["a", "b"]}, "b", True),
    ({"type": "enum", "values": ["a", "b"]}, "c", False),
])
def test_accepts(spec, value, ok):
    assert PropertySpec.model_validate(spec).accepts(value) is ok


# ------------------------------------------------ instance validation
@pytest.fixture
def ont() -> Ontology:
    return Ontology.model_validate(build())


def test_validate_props_ok(ont):
    validate_props(ont, "Customer", {"name": "a", "tier": "gold", "score": 1.5, "active": True})


def test_validate_props_required(ont):
    with pytest.raises(ValueError, match="Customer.name is required"):
        validate_props(ont, "Customer", {"tier": "gold"})


def test_validate_props_partial_skips_required(ont):
    validate_props(ont, "Customer", {"tier": "gold"}, partial=True)


def test_validate_props_unknown(ont):
    with pytest.raises(ValueError, match="Customer has no property \\['colour'\\]"):
        validate_props(ont, "Customer", {"colour": "red"}, partial=True)


def test_validate_props_type(ont):
    with pytest.raises(ValueError, match="Customer.tier='platinum' violates type enum"):
        validate_props(ont, "Customer", {"name": "a", "tier": "platinum"})


def test_validate_props_unknown_type(ont):
    with pytest.raises(ValueError, match="unknown object type: Foo"):
        validate_props(ont, "Foo", {})


def test_validate_params_ok(ont):
    validate_params(ont.action_type("cancel_order"), "cancel_order", {"reason": "oos"})


def test_validate_params_missing_required(ont):
    with pytest.raises(ValueError, match="action cancel_order.reason is required"):
        validate_params(ont.action_type("cancel_order"), "cancel_order", {})


def test_validate_params_wrong_type(ont):
    with pytest.raises(ValueError, match="action cancel_order.reason=42 violates type string"):
        validate_params(ont.action_type("cancel_order"), "cancel_order", {"reason": 42})


def test_validate_params_unknown(ont):
    with pytest.raises(ValueError, match="action cancel_order has no property \\['extra'\\]"):
        validate_params(ont.action_type("cancel_order"), "cancel_order", {"reason": "x", "extra": 1})


def test_effect_param_enum_values_must_be_subset():
    def mutate(r):
        r["action_types"]["cancel_order"]["parameters"]["new_status"] = {"type": "enum", "values": ["open", "lost"]}
        r["action_types"]["cancel_order"]["effects"]["status"] = "$params.new_status"
    assert_invalid(mutate, "parameter 'new_status' values \\['open', 'lost'\\] are not a subset of \\['open', 'shipped'\\]")


def test_effect_param_enum_subset_ok():
    def mutate(r):
        r["action_types"]["cancel_order"]["parameters"]["new_status"] = {"type": "enum", "values": ["shipped"]}
        r["action_types"]["cancel_order"]["effects"]["status"] = "$params.new_status"
    Ontology.model_validate(build(mutate))
