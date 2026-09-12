"""server.py: 実 Postgres + fastmcp インメモリ Client による統合テスト。"""
from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

pytestmark = pytest.mark.anyio


@pytest.fixture
async def client(db_url):
    from server import mcp

    async with Client(mcp) as c:
        yield c


async def call(client, name, **args):
    return (await client.call_tool(name, args)).data


# ---------------------------------------------------------- describe
async def test_describe_ontology(client):
    ont = await call(client, "describe_ontology")
    assert set(ont["object_types"]) == {"Customer", "Order"}
    assert ont["link_types"]["places"]["from"] == "Customer"
    assert "cancel_order" in ont["action_types"]


# ------------------------------------------------------------ search
async def test_search_by_filter(client):
    rows = await call(client, "search_objects", type="Customer", filter={"tier": "gold"})
    assert [r["id"] for r in rows] == ["C001", "C003"]
    assert rows[0]["type"] == "Customer" and rows[0]["name"] == "山田商事"


async def test_search_no_filter_and_limit(client):
    assert len(await call(client, "search_objects", type="Order")) == 5
    assert len(await call(client, "search_objects", type="Order", limit=2)) == 2


@pytest.mark.parametrize("limit", [0, -1, 501])
async def test_search_limit_bounds(client, limit):
    with pytest.raises(ToolError, match="limit"):
        await call(client, "search_objects", type="Order", limit=limit)


async def test_search_unknown_property(client):
    with pytest.raises(ToolError, match="Customer has no property \\['colour'\\]"):
        await call(client, "search_objects", type="Customer", filter={"colour": "red"})


async def test_search_unknown_type(client):
    with pytest.raises(ToolError, match="unknown object type: Invoice"):
        await call(client, "search_objects", type="Invoice")


# --------------------------------------------------------------- get
async def test_get_object(client):
    o = await call(client, "get_object", type="Order", id="O1001")
    assert o == {"type": "Order", "id": "O1001", "amount": 120000, "status": "open"}


async def test_get_object_not_found(client):
    with pytest.raises(ToolError, match="Order#O9999 not found"):
        await call(client, "get_object", type="Order", id="O9999")


# ---------------------------------------------------------- traverse
async def test_traverse_forward(client):
    rows = await call(client, "traverse", type="Customer", id="C001", link="places")
    assert [r["id"] for r in rows] == ["O1001", "O1002"]


async def test_traverse_reverse(client):
    rows = await call(client, "traverse", type="Order", id="O1003", link="places")
    assert [r["id"] for r in rows] == ["C002"]


async def test_traverse_unrelated_type(client):
    with pytest.raises(ToolError, match="link places does not connect Nothing"):
        await call(client, "traverse", type="Nothing", id="x", link="places")


async def test_traverse_unknown_link(client):
    with pytest.raises(ToolError, match="unknown link type: owns"):
        await call(client, "traverse", type="Customer", id="C001", link="owns")


# ---------------------------------------------------- execute_action
async def test_action_ok_updates_and_audits(client, query):
    r = await call(client, "execute_action", action="ship_order", target_id="O1001")
    assert r["ok"] is True and r["object"]["status"] == "shipped"
    assert (await call(client, "get_object", type="Order", id="O1001"))["status"] == "shipped"
    [log] = query("SELECT * FROM audit_log")
    assert (log["actor"], log["action"], log["target_type"], log["target_id"], log["result"]) == ("claude", "ship_order", "Order", "O1001", "ok")
    assert log["before"]["status"] == "open" and log["after"]["status"] == "shipped" and log["error"] is None


async def test_action_with_param(client):
    r = await call(client, "execute_action", action="cancel_order", target_id="O1004", params={"reason": "在庫欠品"})
    assert r["object"] == {"type": "Order", "id": "O1004", "amount": 80000, "status": "cancelled", "note": "在庫欠品"}


async def test_action_precondition_failed(client, query):
    r = await call(client, "execute_action", action="ship_order", target_id="O1002")
    assert r["ok"] is False and r["reason"] == "precondition_failed"
    assert r["failed"] == ["status eq 'open' (actual: 'shipped')"]
    [log] = query("SELECT result, before, after FROM audit_log")
    assert log["result"] == "precondition_failed" and log["before"]["status"] == "shipped" and log["after"] is None


async def test_action_enum_step(client):
    r = await call(client, "execute_action", action="upgrade_tier", target_id="C002")
    assert r["object"]["tier"] == "gold"
    r = await call(client, "execute_action", action="upgrade_tier", target_id="C002")
    assert r["ok"] is False


async def test_action_missing_param_logs_error(client, query):
    with pytest.raises(ToolError, match="action cancel_order.reason is required"):
        await call(client, "execute_action", action="cancel_order", target_id="O1001")
    [log] = query("SELECT * FROM audit_log")
    assert log["result"] == "error" and log["error"].startswith("ValueError: action cancel_order.reason is required")
    assert log["target_type"] == "Order" and log["target_id"] == "O1001" and log["params"] == {}
    assert (await call(client, "get_object", type="Order", id="O1001"))["status"] == "open", "対象は変更されない"


async def test_action_wrong_param_type_logs_error(client, query):
    with pytest.raises(ToolError, match="reason=42 violates type string"):
        await call(client, "execute_action", action="cancel_order", target_id="O1001", params={"reason": 42})
    assert query("SELECT result FROM audit_log") == [{"result": "error"}]


async def test_action_target_not_found_logs_error(client, query):
    with pytest.raises(ToolError, match="Order#O9999 not found"):
        await call(client, "execute_action", action="ship_order", target_id="O9999")
    [log] = query("SELECT result, error, before FROM audit_log")
    assert log["result"] == "error" and "not found" in log["error"] and log["before"] is None


async def test_action_unknown_action_not_logged(client, query):
    with pytest.raises(ToolError, match="unknown action: explode"):
        await call(client, "execute_action", action="explode", target_id="O1001")
    assert query("SELECT count(*) AS n FROM audit_log") == [{"n": 0}]


async def test_action_error_after_fetch_keeps_before(client, query, db_url):
    """対象取得後の失敗 (DB 内の enum 値が不正) でも監査行に before が残る。"""
    import psycopg
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("""UPDATE objects SET props = '{"name":"x","tier":"platinum"}' WHERE type='Customer' AND id='C001'""")
    with pytest.raises(ToolError, match="current value 'platinum' is not one of"):
        await call(client, "execute_action", action="upgrade_tier", target_id="C001")
    [log] = query("SELECT result, before FROM audit_log")
    assert log["result"] == "error" and log["before"] == {"name": "x", "tier": "platinum"}


async def test_audit_write_failure_does_not_mask_error(client, query, monkeypatch, caplog):
    import server

    real_audit = server._audit

    def flaky_audit(conn, **kw):
        if kw["result"] == "error":
            raise RuntimeError("audit table is on fire")
        return real_audit(conn, **kw)

    monkeypatch.setattr(server, "_audit", flaky_audit)
    with pytest.raises(ToolError, match="Order#O9999 not found"):
        await call(client, "execute_action", action="ship_order", target_id="O9999")
    assert "failed to write error audit row" in caplog.text
    assert query("SELECT count(*) AS n FROM audit_log") == [{"n": 0}]
