"""
ontology-mcp — YAML で宣言したオントロジーを MCP ツールとして公開する最小サーバー。

公開ツール (型ごとには生やさない。5 本で全型を扱う):
  describe_ontology()                       型・リンク・アクションの一覧
  search_objects(type, filter, limit)       プロパティ条件で検索
  get_object(type, id)                      1 件取得
  traverse(type, id, link)                  リンクをたどる (順方向/逆方向)
  execute_action(action, target_id, params) precondition 検証 → effect 適用 → 監査ログ

環境変数:
  ONTOLOGY_PATH  ontology.yaml のパス (default: ./ontology.yaml)
  DATABASE_URL   postgresql://user:pass@host:5432/db
  ACTOR          監査ログに残す実行主体 (default: claude)
  MCP_TRANSPORT  stdio | http (default: stdio)
  MCP_HOST / MCP_PORT  http のときの待ち受け (default: 0.0.0.0 / 8000)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Annotated, Any

import psycopg
from fastmcp import FastMCP
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import Field

from actions import apply_effects, check_conditions
from ontology import ActionType, load_ontology, validate_params, validate_props

ONTOLOGY_PATH = Path(os.environ.get("ONTOLOGY_PATH", Path(__file__).with_name("ontology.yaml")))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ontology:ontology@localhost:5432/ontology")
ACTOR = os.environ.get("ACTOR", "claude")

DEFAULT_LIMIT = 50
MAX_LIMIT = 500
Limit = Annotated[int, Field(ge=1, le=MAX_LIMIT, description=f"最大件数 (1〜{MAX_LIMIT})")]

# 起動時に検証する: 定義が壊れていればここで落ちる (OntologyError)
ONT = load_ontology(ONTOLOGY_PATH)

mcp = FastMCP("ontology-mcp")
log = logging.getLogger("ontology-mcp")


# --------------------------------------------------------------------- db
def db() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def _row(r: dict) -> dict:
    return {"type": r["type"], "id": r["id"], **r["props"]}


def _audit(
    conn: psycopg.Connection,
    *,
    action: str,
    target_type: str,
    target_id: str,
    params: dict,
    before: dict | None,
    after: dict | None,
    result: str,
    error: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO audit_log(actor, action, target_type, target_id, params, before, after, result, error)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (ACTOR, action, target_type, target_id, Jsonb(params), _jsonb(before), _jsonb(after), result, error),
    )


def _jsonb(v: dict | None) -> Jsonb | None:
    return None if v is None else Jsonb(v)


# ------------------------------------------------------------------ tools
@mcp.tool
def describe_ontology() -> dict:
    """オントロジー全体 (ObjectType / LinkType / ActionType) を返す。最初に必ず呼ぶこと。"""
    return ONT.to_dict()


@mcp.tool
def search_objects(type: str, filter: dict[str, Any] | None = None, limit: Limit = DEFAULT_LIMIT) -> list[dict]:
    """ObjectType のインスタンスを検索する。filter は {property: value} の完全一致 (AND)。"""
    validate_props(ONT, type, filter or {}, partial=True)
    with db() as conn:
        rows = conn.execute(
            "SELECT type, id, props FROM objects WHERE type=%s AND props @> %s ORDER BY id LIMIT %s",
            (type, Jsonb(filter or {}), limit),
        ).fetchall()
    return [_row(r) for r in rows]


@mcp.tool
def get_object(type: str, id: str) -> dict:
    """ObjectType と主キーで 1 件取得する。"""
    ONT.object_type(type)
    with db() as conn:
        r = conn.execute("SELECT type, id, props FROM objects WHERE type=%s AND id=%s", (type, id)).fetchone()
    if not r:
        raise ValueError(f"{type}#{id} not found")
    return _row(r)


@mcp.tool
def traverse(type: str, id: str, link: str) -> list[dict]:
    """オブジェクトからリンクをたどる。type が link の from 側なら順方向、to 側なら逆方向。"""
    lt = ONT.link_type(link)
    if type == lt.from_:
        sql, target = "SELECT o.type, o.id, o.props FROM links l JOIN objects o ON o.type=%s AND o.id=l.to_id WHERE l.type=%s AND l.from_id=%s ORDER BY o.id", lt.to
    elif type == lt.to:
        sql, target = "SELECT o.type, o.id, o.props FROM links l JOIN objects o ON o.type=%s AND o.id=l.from_id WHERE l.type=%s AND l.to_id=%s ORDER BY o.id", lt.from_
    else:
        raise ValueError(f"link {link} does not connect {type} ({lt.from_} -> {lt.to})")
    with db() as conn:
        rows = conn.execute(sql, (target, link, id)).fetchall()
    return [_row(r) for r in rows]


@mcp.tool
def execute_action(action: str, target_id: str, params: dict[str, Any] | None = None) -> dict:
    """ActionType を実行する。precondition を検証し、通れば effect を適用して監査ログに記録する。

    precondition 不成立は ok=False で返す。それ以外の失敗 (パラメータ不正、対象なし、型違反) は
    エラーとして送出し、audit_log に result=error で記録する。
    """
    at = ONT.action_type(action)
    params = params or {}
    before: dict | None = None
    with db() as conn:
        try:
            with conn.transaction():
                validate_params(at, action, params)
                before = _lock_target(conn, at.target, target_id)
                return _apply_action(conn, action, at, target_id, params, before)
        except Exception as e:
            # 上の transaction はロールバック済み。監査行だけ別トランザクションで残す。
            _audit_error(conn, action=action, target_type=at.target, target_id=target_id, params=params, before=before, exc=e)
            raise


def _lock_target(conn: psycopg.Connection, ttype: str, target_id: str) -> dict:
    r = conn.execute("SELECT props FROM objects WHERE type=%s AND id=%s FOR UPDATE", (ttype, target_id)).fetchone()
    if not r:
        raise ValueError(f"{ttype}#{target_id} not found")
    return r["props"]


def _apply_action(conn: psycopg.Connection, action: str, at: ActionType, target_id: str, params: dict, before: dict) -> dict:
    ttype = at.target
    failed = check_conditions(at.preconditions, before)
    if failed:
        _audit(conn, action=action, target_type=ttype, target_id=target_id, params=params,
               before=before, after=None, result="precondition_failed")
        return {"ok": False, "reason": "precondition_failed", "failed": failed, "object": {"type": ttype, "id": target_id, **before}}

    after = apply_effects(ONT.object_type(ttype), at.effects, before, params)
    validate_props(ONT, ttype, after)
    conn.execute("UPDATE objects SET props=%s, updated_at=now() WHERE type=%s AND id=%s", (Jsonb(after), ttype, target_id))
    _audit(conn, action=action, target_type=ttype, target_id=target_id, params=params,
           before=before, after=after, result="ok")
    return {"ok": True, "object": {"type": ttype, "id": target_id, **after}}


def _audit_error(conn: psycopg.Connection, *, action: str, target_type: str, target_id: str,
                 params: dict, before: dict | None, exc: Exception) -> None:
    """失敗を監査ログに残す。監査行の書き込み自体が失敗しても元の例外を隠さない。"""
    try:
        with conn.transaction():
            _audit(conn, action=action, target_type=target_type, target_id=target_id, params=params,
                   before=before, after=None, result="error", error=f"{type(exc).__name__}: {exc}")
    except Exception:
        log.exception("failed to write error audit row for %s on %s#%s", action, target_type, target_id)

if __name__ == "__main__":  # pragma: no cover
    if os.environ.get("MCP_TRANSPORT", "stdio") == "http":
        mcp.run(transport="http", host=os.environ.get("MCP_HOST", "0.0.0.0"), port=int(os.environ.get("MCP_PORT", "8000")))
    else:
        mcp.run()
