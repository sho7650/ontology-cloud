-- 汎用インスタンスストア: 型ごとのテーブルを作らず 2 テーブルで全型を保持する。
-- props は JSON テキスト。フィルタは json_extract(props, '$.key') = ? で行う。
CREATE TABLE IF NOT EXISTS objects (
  type       TEXT NOT NULL,
  id         TEXT NOT NULL,
  props      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (type, id)
);

CREATE TABLE IF NOT EXISTS links (
  type    TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  PRIMARY KEY (type, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS links_to ON links (type, to_id);

-- Action の監査ログ。result: ok | precondition_failed | error
CREATE TABLE IF NOT EXISTS audit_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  params      TEXT,
  before      TEXT,
  after       TEXT,
  result      TEXT NOT NULL,
  error       TEXT
);
