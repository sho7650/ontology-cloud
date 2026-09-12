# ontology-mcp — YAML 宣言オントロジー × MCP × Claude

「型を YAML に宣言するだけで、Claude がその世界を探索し、ルールに従って操作できる」を最小構成で示すデモです。

- **ontology.yaml** に ObjectType (型) / LinkType (関係) / ActionType (操作とその前提条件・効果) を宣言する
- **server.py** は YAML を読んで、型に依存しない汎用 5 ツールを MCP で公開する
- **Postgres** が 2 テーブル (`objects`, `links`) で全型のインスタンスを持ち、`audit_log` に操作を記録する
- **Claude** (Claude Code / Claude Desktop) がオーケストレーターとして、ツールを組み合わせて自然言語の依頼をこなす

ポイントは「型を足してもコードは変わらない」ことと、「オブジェクトの変更はアクション経由でしかできず、前提条件はサーバー側で強制される」ことです。

| 要素 | ファイル | 役割 |
|---|---|---|
| オントロジー定義 | `ontology.yaml` | ObjectType / LinkType / ActionType の宣言。**本体はここ** |
| インスタンスストア | `schema.sql` | Postgres 2 テーブル (`objects`, `links`) + 監査ログ + サンプルデータ |
| オントロジー MCP | `server.py` / `ontology.py` / `actions.py` / `Dockerfile` | YAML を検証して読み、DB を包む汎用 5 ツールを HTTP で公開 |
| オーケストレーター | Claude Code / Claude Desktop | MCP を登録するだけ。判断と手順の組み立ては Claude がやる |

## 1. 起動

`docker compose up -d --build` の一発で DB と MCP サーバーの両方が上がります。

```bash
docker compose up -d --build
docker compose logs -f ontology-mcp   # ログ確認
```

- `db` : Postgres 16。初回起動時に `schema.sql` (DDL + サンプルデータ) を自動投入。ローカルからのテスト用に `127.0.0.1:5432` にも公開
- `ontology-mcp` : `server.py` を HTTP transport で `http://<host>:8000/mcp` に公開。`ontology.yaml` はマウントしているので、編集後は `docker compose restart ontology-mcp` だけで反映。定義が不正なら起動時にエラーで落ち、理由がログに出る

`schema.sql` は初回起動時にしか自動実行されません。既存の `pgdata` ボリュームにスキーマ変更を追従させるには、冪等なので丸ごと流し直します:

```bash
docker compose exec -T db psql -U ontology -d ontology < schema.sql
```

## 2. Claude に登録

**Claude Code**:

```bash
claude mcp add --transport http ontology http://localhost:8000/mcp
# 別ホスト (例: tina) で動かしているなら http://tina:8000/mcp
```

**Claude Desktop** は HTTP MCP を直接登録できるバージョンなら Settings → Connectors から URL を追加します。
stdio が必要な場合は compose を使わず `MCP_TRANSPORT=stdio python server.py` を `claude_desktop_config.json` の `command` に指定し、環境変数 `DATABASE_URL` を `env` で渡します。

## 3. サンプルデータ

| Customer | name | tier | 注文 (places) |
|---|---|---|---|
| C001 | 山田商事 | gold | O1001 (open, 120,000) / O1002 (shipped, 45,000) |
| C002 | 佐藤工業 | silver | O1003 (open, 300,000) |
| C003 | 鈴木製作所 | gold | O1004 (open, 80,000) / O1005 (cancelled, 15,000) |

アクションは 3 つ: `cancel_order` (open のみ、`reason` 必須)、`ship_order` (open のみ)、`upgrade_tier` (gold 以外、bronze→silver→gold)。

## 4. 試してみる

このデモが今できること・できないことを、そのまま Claude に投げられるプロンプトで並べます。

### できること (そのまま通る)

**探索・読み取り**

- 「このオントロジーにはどんな型とアクションがある？」→ `describe_ontology` で全体像を答える
- 「Gold 顧客を一覧して」→ `search_objects(Customer, {tier: gold})`
- 「山田商事の注文を全部見せて」→ 名前で検索 → `traverse(places)`
- 「注文 O1003 は誰の注文？」→ `traverse` を逆方向にたどる
- 「未出荷の注文の合計金額は？」→ `search_objects(Order, {status: open})` を Claude が集計

**アクション実行 (オーケストレーションの見せ場)**

- 「Gold 顧客の未出荷注文を『在庫欠品』を理由に全部キャンセルして」→ 検索 → 辿る → 1 件ずつ `cancel_order`
- 「O1004 を出荷済みにして」→ `ship_order`
- 「佐藤工業のティアを上げて」→ `upgrade_tier` (silver→gold)
- 「今回の操作の監査ログを確認したい」→ これは MCP には無いので、Claude は「DB の `audit_log` を見てください」と言うはず。SQL で確認する:

```bash
docker compose exec -T db psql -U ontology -d ontology -c \
  "SELECT at, actor, action, target_id, result, error FROM audit_log ORDER BY seq DESC LIMIT 20"
```

### できるけど「拒否される」のを見せるもの (設計どおりの挙動)

- 「O1002 をキャンセルして」→ 出荷済みなので precondition で失敗。Claude が理由を報告する
- 「O1005 を出荷済みにして」→ キャンセル済みなので同様に拒否
- 「山田商事のティアを上げて」→ すでに gold なので拒否
- 「理由なしで O1004 をキャンセルして」→ `reason` は必須パラメータなのでエラー。Claude が理由を聞き返すはず
- 「注文 O1001 のステータスを直接 'refunded' にして」→ `refunded` は enum にないうえ、そもそもプロパティを直接書き換えるツールが無い。「アクション経由でしか変更できない」ことの説明になる

precondition 不成立は `ok: false` と理由を返し `audit_log` に `precondition_failed` として残ります。パラメータ不足・型違い・対象なしはツールエラーになり、`audit_log` に `error` と例外内容が残ります。どちらの場合も対象オブジェクトは変更されません。

### できないこと (今の最小構成の範囲外)

- **オブジェクトの新規作成・削除**: 「新しい顧客を登録して」は不可。`create_object` ツールが無い (意図的。デモでは SQL で INSERT)
- **リンクの作成・削除**: 「この注文を佐藤工業に紐付けて」は不可
- **範囲・部分一致検索**: 「10 万円以上の注文」「名前に『工業』を含む顧客」は `search_objects` が完全一致のみなので、Claude が全件取ってから絞る形になる (件数が多いと破綻する。`limit` の上限は 500)
- **複数オブジェクトにまたがる precondition**: 「顧客が gold のときだけキャンセル可」のような、リンク先を見る条件は書けない
- **アクションの一括実行・トランザクション**: 1 件ずつ実行なので、途中で失敗しても前の分はロールバックされない
- **権限・認証**: MCP は無認証で、`ACTOR` は固定値。「誰が何をできるか」は未実装 (デモ用途のため意図的)
- **時間・履歴クエリ**: 「昨日キャンセルされた注文」は `audit_log` に直接 SQL を打つ必要がある

この「できない」リストがそのまま第 2 段階の候補です。特に範囲検索とリンク先を見る precondition は、`ontology.yaml` の語彙を少し広げるだけで足せます。

## 5. 「型を足してもコードは変わらない」を見せる

`ontology.yaml` に追記して `docker compose restart ontology-mcp` するだけです:

```yaml
object_types:
  Product:
    key: product_id
    properties:
      name:  {type: string, required: true}
      stock: {type: integer, required: true}
link_types:
  contains: {from: Order, to: Product, cardinality: many_to_many}
action_types:
  restock:
    target: Product
    parameters: {qty: {type: integer, required: true}}
    preconditions: [{property: stock, op: lt, value: 10}]
    effects: {stock: 100}
```

インスタンスは SQL で入れます:

```sql
INSERT INTO objects (type, id, props) VALUES ('Product', 'P001', '{"name":"ボルト","stock":3}');
INSERT INTO links (type, from_id, to_id) VALUES ('contains', 'O1001', 'P001');
```

参照先の型名を間違えるなど定義に矛盾があれば、起動時に全件まとめて報告して止まります (下記「起動時の検証」)。

## 6. 公開ツール

| ツール | 説明 |
|---|---|
| `describe_ontology()` | 型・リンク・アクション一覧。Claude が最初に呼ぶ |
| `search_objects(type, filter, limit)` | プロパティ完全一致 (AND) で検索。`limit` は 1〜500 (既定 50) |
| `get_object(type, id)` | 1 件取得 |
| `traverse(type, id, link)` | リンクを順方向 / 逆方向にたどる |
| `execute_action(action, target_id, params)` | パラメータ検証 → precondition 検証 → effect 適用 → `audit_log` に記録 |

## 7. YAML の語彙

- 型は `string integer number boolean enum`。`enum` は `values` を昇順に宣言する
- `preconditions`: `{property, op, value}` のリスト。op は `eq ne gt gte lt lte in contains`。比較できない組み合わせ (未設定プロパティに `gt` など) は不成立として扱う
- `effects`: `{property: value}`。値には `$params.<name>`, `$next_enum`, `$prev_enum` が使える。`$params` で参照した任意パラメータが省略された場合、そのプロパティは変更しない
- `parameters`: プロパティと同じ `{type, required, values}` で宣言する。未知のパラメータは拒否される

### 起動時の検証

`ontology.py` (pydantic) が読み込み時に次を検証し、違反があれば全件まとめて報告して起動を止めます:

- 未知のキー、未知の `type` / `op` / `cardinality`
- `enum` は空でない一意な `values` を持つこと。`values` は enum 以外に書けない
- `link_types` の `from` / `to`、`action_types` の `target` が `object_types` に存在すること
- `preconditions` / `effects` のプロパティが `target` に存在すること
- `$params.<name>` は `parameters` に宣言済みで、プロパティと同じ型であること。enum なら `values` が対象プロパティの部分集合であること
- `$next_enum` / `$prev_enum` は enum プロパティにのみ使えること
- リテラルの effect 値がプロパティの型に合うこと

## 8. 環境変数 (ontology-mcp)

| 変数 | compose での値 | 意味 |
|---|---|---|
| `DATABASE_URL` | `postgresql://ontology:ontology@db:5432/ontology` | 接続先 (単体実行時の既定は `localhost`) |
| `MCP_TRANSPORT` | `http` | `http` / `stdio` (既定は `stdio`) |
| `MCP_HOST` / `MCP_PORT` | `0.0.0.0` / `8000` | http の待ち受け |
| `ONTOLOGY_PATH` | `/app/ontology.yaml` | 定義ファイル |
| `ACTOR` | `claude` | 監査ログの実行主体 |

## 9. 開発・テスト

依存は `requirements.txt` で固定しています (fastmcp 4.0.3 / psycopg 3.3.5 / PyYAML 6.0.3)。

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
docker compose up -d db          # 統合テスト用 (127.0.0.1:5432)
.venv/bin/python -m pytest       # 単体 + 統合。カバレッジ 80% 未満なら失敗
```

- `tests/test_ontology.py` / `tests/test_actions.py`: DB 不要の単体テスト (スキーマ検証、precondition / effect の評価)
- `tests/test_server.py`: 実 Postgres + fastmcp のインメモリ Client で 5 ツールを通す統合テスト
- 統合テストは `ontology` DB に接続して専用の `ontology_test` DB を作り、テストごとにサンプルデータを入れ直します (デモ用 DB には触りません)。接続先は `TEST_ADMIN_DATABASE_URL` で変更でき、DB に届かなければ統合テストは skip されます

## 10. 次の段階

- `search_objects` に範囲・部分一致条件 (`amount gte 100000`、`name contains 工業`) を足す
- リンク先を見る precondition (「顧客が gold のときだけ」) を YAML の語彙に加える
- `create_object` / `link_objects` ツールで新規作成と紐付けを Claude から行えるようにする
- `audit_log` を Grafana に流して「誰が・どの型に・何をした」を可視化する
- 判断ロジック (与信など) を別プロセスのエージェントにし、A2A で Claude から呼ぶ

## ライセンス

[MIT License](LICENSE)
