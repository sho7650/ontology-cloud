"""
テスト共通フィクスチャ。

統合テストは実 Postgres を使う。docker compose up -d db で起動した DB に
TEST_ADMIN_DATABASE_URL (既定: ontology DB) で接続し、専用の ontology_test DB を作って
テストごとに全テーブルを TRUNCATE してから schema.sql (冪等な DDL + サンプルデータ) を流し直す。
DB に届かなければ統合テストは skip。
"""
from __future__ import annotations

import os
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = (ROOT / "schema.sql").read_text(encoding="utf-8")
ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://ontology:ontology@localhost:5432/ontology")
TEST_DB = "ontology_test"
TABLES = ("objects", "links", "audit_log")


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
def test_database_url() -> str:
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3) as conn:
            if not conn.execute("SELECT 1 FROM pg_database WHERE datname=%s", (TEST_DB,)).fetchone():
                conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    except psycopg.OperationalError as e:
        pytest.skip(f"Postgres not reachable at {ADMIN_URL}: {e}")
    return make_conninfo(**{**conninfo_to_dict(ADMIN_URL), "dbname": TEST_DB})


@pytest.fixture
def db_url(test_database_url: str, monkeypatch: pytest.MonkeyPatch) -> str:
    """server が使う DB をテスト DB に向け、サンプルデータを初期状態に戻す。"""
    import server

    monkeypatch.setattr(server, "DATABASE_URL", test_database_url)
    with psycopg.connect(test_database_url, autocommit=True) as conn:
        conn.execute(SCHEMA_SQL)  # テーブルが無ければ作る (冪等)
        conn.execute(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY")
        conn.execute(SCHEMA_SQL)  # サンプルデータを入れ直す
    return test_database_url


@pytest.fixture
def query(db_url: str):
    """テスト DB に対して SELECT を投げるヘルパー。"""
    def _query(sql: str, params: tuple = ()) -> list[dict]:
        with psycopg.connect(db_url, row_factory=dict_row) as conn:
            return conn.execute(sql, params).fetchall()
    return _query
