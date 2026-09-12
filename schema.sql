-- 汎用インスタンスストア: 型ごとのテーブルを作らず 2 テーブルで全型を保持する
CREATE TABLE IF NOT EXISTS objects (
  type       TEXT        NOT NULL,
  id         TEXT        NOT NULL,
  props      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (type, id)
);
CREATE INDEX IF NOT EXISTS objects_props_gin ON objects USING gin (props);

CREATE TABLE IF NOT EXISTS links (
  type    TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  PRIMARY KEY (type, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS links_to ON links (type, to_id);

-- Action の監査ログ (Grafana に流す用)
CREATE TABLE IF NOT EXISTS audit_log (
  seq        BIGSERIAL   PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  target_type TEXT       NOT NULL,
  target_id  TEXT        NOT NULL,
  params     JSONB,
  before     JSONB,
  after      JSONB,
  result     TEXT        NOT NULL,  -- ok | precondition_failed | error
  error      TEXT                    -- result=error のとき例外の内容
);
-- 既存 DB への追従用 (schema.sql は初回起動時にしか自動実行されないため冪等にしてある)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS error TEXT;

-- ---------------------------------------------------------------
-- サンプルデータ
-- ---------------------------------------------------------------
INSERT INTO objects (type, id, props) VALUES
  ('Customer', 'C001', '{"name":"山田商事",   "tier":"gold",   "email":"yamada@example.com"}'),
  ('Customer', 'C002', '{"name":"佐藤工業",   "tier":"silver", "email":"sato@example.com"}'),
  ('Customer', 'C003', '{"name":"鈴木製作所", "tier":"gold",   "email":"suzuki@example.com"}'),
  ('Order', 'O1001', '{"amount":120000, "status":"open"}'),
  ('Order', 'O1002', '{"amount": 45000, "status":"shipped"}'),
  ('Order', 'O1003', '{"amount":300000, "status":"open"}'),
  ('Order', 'O1004', '{"amount": 80000, "status":"open"}'),
  ('Order', 'O1005', '{"amount": 15000, "status":"cancelled"}')
ON CONFLICT DO NOTHING;

INSERT INTO links (type, from_id, to_id) VALUES
  ('places', 'C001', 'O1001'),
  ('places', 'C001', 'O1002'),
  ('places', 'C002', 'O1003'),
  ('places', 'C003', 'O1004'),
  ('places', 'C003', 'O1005')
ON CONFLICT DO NOTHING;
