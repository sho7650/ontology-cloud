# ontology-mcp 改善タスク (2026-09-12)

/sc:analyze の指摘に対するユーザー決定: 認証は不要 (デモ)、0.0.0.0 のまま。

- [x] 1. 依存を requirements.txt でピン留め (fastmcp 4.0.3 = 稼働中コンテナと同一)、requirements-dev.txt 追加
- [x] 2. ontology.yaml の起動時スキーマ検証 (pydantic) — ontology.py に分離
- [x] 3. アクションパラメータの型・未知パラメータ検証、limit の上下限 (1〜500)
- [x] 4. 例外時に audit_log へ result=error 行を記録 (error 列追加、稼働中 DB にも ALTER 適用済み)
- [x] 5. テスト: 単体 (ontology / actions) + 統合 (Postgres + fastmcp in-memory Client)
- [x] 6. docker-compose: db を 127.0.0.1:5432 に公開 (テスト用)
- [x] 7. README / schema.sql 更新、全テスト通過とカバレッジ確認

## Review

- pytest: 95 passed (レビュー指摘 3 件を修正後)、カバレッジ 100% (server.py / ontology.py / actions.py)
- 稼働中コンテナを再ビルドし、HTTP 経由で describe / limit=0 拒否 / 型違いパラメータ拒否 / precondition_failed を確認
- 監査ログの actor は認証を入れない決定のため静的な ACTOR 環境変数のまま
- 動作変更: `$params.x` で参照した任意パラメータ省略時はプロパティを変更しない (旧: None を入れて型検証で落ちていた)。比較不能な precondition は不成立扱い (旧: TypeError)
