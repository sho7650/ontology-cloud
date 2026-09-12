"""
ontology.yaml のスキーマ定義と検証。

起動時に load_ontology() で YAML を pydantic モデルへ変換し、
型・リンク・アクション間の参照整合性まで検証する。
不正な定義は実行時ではなく起動時に OntologyError で落とす。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

PropType = Literal["string", "integer", "number", "boolean", "enum"]
Op = Literal["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]
Cardinality = Literal["one_to_one", "one_to_many", "many_to_one", "many_to_many"]

PARAM_REF_PREFIX = "$params."
ENUM_STEP_EXPRS = ("$next_enum", "$prev_enum")


class OntologyError(ValueError):
    """ontology.yaml が読めない、または定義が不正。"""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PropertySpec(_Strict):
    """ObjectType のプロパティ、および ActionType のパラメータの宣言。"""

    type: PropType
    required: bool = False
    values: list[str] | None = None
    description: str | None = None

    @model_validator(mode="after")
    def _check_enum_values(self) -> PropertySpec:
        if self.type == "enum":
            if not self.values:
                raise ValueError("enum requires a non-empty 'values' list")
            if len(set(self.values)) != len(self.values):
                raise ValueError(f"enum values must be unique: {self.values}")
        elif self.values is not None:
            raise ValueError(f"'values' is only valid for enum, not {self.type}")
        return self

    def accepts(self, value: Any) -> bool:
        """値がこの宣言の型に合うか。bool は integer/number として扱わない。"""
        if isinstance(value, bool):
            return self.type == "boolean"
        if self.type == "string":
            return isinstance(value, str)
        if self.type == "integer":
            return isinstance(value, int)
        if self.type == "number":
            return isinstance(value, (int, float))
        if self.type == "enum":
            return value in (self.values or [])
        return False

    def describe(self) -> str:
        return f"{self.type} {self.values}" if self.type == "enum" else self.type


class ObjectType(_Strict):
    description: str | None = None
    key: str | None = None
    properties: dict[str, PropertySpec] = Field(default_factory=dict)


class LinkType(_Strict):
    description: str | None = None
    from_: str = Field(alias="from")
    to: str
    cardinality: Cardinality = "many_to_many"


class Condition(_Strict):
    property: str
    op: Op
    value: Any = None


class ActionType(_Strict):
    description: str | None = None
    target: str
    parameters: dict[str, PropertySpec] = Field(default_factory=dict)
    preconditions: list[Condition] = Field(default_factory=list)
    effects: dict[str, Any] = Field(default_factory=dict)


class Ontology(_Strict):
    version: int = 1
    object_types: dict[str, ObjectType]
    link_types: dict[str, LinkType] = Field(default_factory=dict)
    action_types: dict[str, ActionType] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_references(self) -> Ontology:
        errors = [*self._link_errors(), *self._action_errors()]
        if errors:
            raise ValueError("\n".join(errors))
        return self

    def _link_errors(self) -> list[str]:
        errors = []
        for name, lt in self.link_types.items():
            for side, tname in (("from", lt.from_), ("to", lt.to)):
                if tname not in self.object_types:
                    errors.append(f"link_types.{name}.{side}: unknown object type {tname!r}")
        return errors

    def _action_errors(self) -> list[str]:
        errors = []
        for name, at in self.action_types.items():
            target = self.object_types.get(at.target)
            if target is None:
                errors.append(f"action_types.{name}.target: unknown object type {at.target!r}")
                continue
            for c in at.preconditions:
                if c.property not in target.properties:
                    errors.append(f"action_types.{name}.preconditions: {at.target} has no property {c.property!r}")
            for prop, expr in at.effects.items():
                errors.extend(_effect_errors(f"action_types.{name}.effects.{prop}", at, target, prop, expr))
        return errors

    def object_type(self, name: str) -> ObjectType:
        return _lookup(self.object_types, name, "object type")

    def link_type(self, name: str) -> LinkType:
        return _lookup(self.link_types, name, "link type")

    def action_type(self, name: str) -> ActionType:
        return _lookup(self.action_types, name, "action")

    def to_dict(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


def _effect_errors(where: str, at: ActionType, target: ObjectType, prop: str, expr: Any) -> list[str]:
    spec = target.properties.get(prop)
    if spec is None:
        return [f"{where}: {at.target} has no property {prop!r}"]
    if isinstance(expr, str) and expr.startswith(PARAM_REF_PREFIX):
        pname = expr[len(PARAM_REF_PREFIX):]
        if pname not in at.parameters:
            return [f"{where}: references undeclared parameter {pname!r}"]
        param = at.parameters[pname]
        if param.type != spec.type:
            return [f"{where}: parameter {pname!r} is {param.type}, property is {spec.type}"]
        if spec.type == "enum" and not set(param.values or []) <= set(spec.values or []):
            return [f"{where}: parameter {pname!r} values {param.values} are not a subset of {spec.values}"]
        return []
    if isinstance(expr, str) and expr in ENUM_STEP_EXPRS:
        return [] if spec.type == "enum" else [f"{where}: {expr} requires an enum property, {prop!r} is {spec.type}"]
    if not spec.accepts(expr):
        return [f"{where}: literal {expr!r} violates type {spec.describe()}"]
    return []


def _lookup(table: dict, name: str, kind: str):
    try:
        return table[name]
    except KeyError:
        raise ValueError(f"unknown {kind}: {name}. known: {list(table)}") from None


def load_ontology(path: Path) -> Ontology:
    """YAML を読み、スキーマと参照整合性を検証して返す。失敗は OntologyError。"""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise OntologyError(f"ontology file not found: {path}") from None
    except yaml.YAMLError as e:
        raise OntologyError(f"ontology file {path} is not valid YAML: {e}") from e
    if not isinstance(raw, dict):
        raise OntologyError(f"ontology file {path} must be a mapping at top level")
    try:
        return Ontology.model_validate(raw)
    except ValidationError as e:
        raise OntologyError(f"invalid ontology {path}:\n{e}") from e


def validate_props(ont: Ontology, type_name: str, props: dict, *, partial: bool = False) -> None:
    """インスタンスのプロパティが ObjectType の宣言に合っているか検証する。"""
    _validate_values(ont.object_type(type_name).properties, props, owner=type_name, partial=partial)


def validate_params(action: ActionType, action_name: str, params: dict) -> None:
    """アクション呼び出しのパラメータが宣言に合っているか検証する。"""
    _validate_values(action.parameters, params, owner=f"action {action_name}", partial=False)


def _validate_values(spec: dict[str, PropertySpec], values: dict, *, owner: str, partial: bool) -> None:
    unknown = set(values) - set(spec)
    if unknown:
        raise ValueError(f"{owner} has no property {sorted(unknown)}")
    for name, rule in spec.items():
        if name not in values:
            if rule.required and not partial:
                raise ValueError(f"{owner}.{name} is required")
            continue
        if not rule.accepts(values[name]):
            raise ValueError(f"{owner}.{name}={values[name]!r} violates type {rule.describe()}")
