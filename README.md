# ontology-mcp — YAML 宣言オントロジー × MCP × Claude (Cloudflare Workers 版)

「型を YAML に宣言するだけで、Claude がその世界を探索し、ルールに従って操作できる」を最小構成で示すデモです。
Cloudflare Workers + D1 上で動き、Google アカウントでログインすれば誰でも自分の Claude から試せます。

- **ontology.yaml** に ObjectType (型) / LinkType (関係) / ActionType (操作とその前提条件・効果) を宣言する
- **Worker** は YAML を読んで、型に依存しない汎用 5 ツールを MCP (Streamable HTTP + OAuth 2.1) で公開する
- **D1** が 2 テーブル (`objects`, `links`) で全型のインスタンスを持ち、`audit_log` に「誰が・何を・どうしたか」を記録する
- **Claude** (Claude Code / Claude Desktop) がオーケストレーターとして、ツールを組み合わせて自然言語の依頼をこなす

ポイントは「型を足してもコードは変わらない」ことと、「オブジェクトの変更はアクション経由でしかできず、前提条件はサーバー側で強制される」ことです。

| 要素 | ファイル | 役割 |
|---|---|---|
| オントロジー定義 | `ontology.yaml` | ObjectType / LinkType / ActionType の宣言。**本体はここ** |
| スキーマ検証 | `src/ontology/` | zod で YAML を検証し、precondition / effect を評価する純粋関数 |
| インスタンスストア | `migrations/`, `src/store/` | D1 の `objects` / `links` / `audit_log`、楽観ロック付きアクション実行、サンプルデータ |
| MCP サーバー | `src/mcp/` | 汎用 5 ツール + 所有者専用 `reset_sample_data` |
| 認証 | `src/auth/`, `src/index.ts` | `@cloudflare/workers-oauth-provider` で Google を上流にした OAuth 2.1 (Dynamic Client Registration 対応) |
| 管理画面 | `src/admin/` | `/admin` で所有者だけがデータ一覧とリセットを行える |
| 公開ページ | `src/home.ts`, `src/legal/` | `/` (アプリの説明)、`/privacy`、`/terms` — Google の OAuth 同意画面に登録するホームページ・プライバシーポリシー・利用規約 |
| 画像 | `public/` | トップページの `hero.jpg` (1600×900) と、X / note.com などのリンクカード用 `og-image.jpg` (1200×630)。Workers の静的アセットとして `/` 直下で配信 |

## 1. 試す (公開デモに接続する)

**Claude Code**:

```bash
claude mcp add --transport http ontology https://ontology-mcp.<サブドメイン>.workers.dev/mcp
```

Claude Code 内で `/mcp` を開き ontology を選ぶとブラウザが開くので、Google アカウントでログインして承認します。
**Claude Desktop** は Settings → Connectors から同じ URL を追加します。

データは利用者全員で共有されます。誰かが出荷やキャンセルをすると他の人にも見えます。荒れたら所有者がリセットします。

## 2. サンプルデータ

顧客 10 社、注文 30 件、商品 8 点。README のプロンプト例が前提にしている行は固定です。

| Customer | name | tier | 注文 (places) |
|---|---|---|---|
| C001 | 山田商事 | gold | O1001 (open, 120,000) / O1002 (shipped, 45,000) / O1014 / O1024 |
| C002 | 佐藤工業 | silver | O1003 (open, 300,000) / O1015 / O1027 |
| C003 | 鈴木製作所 | gold | O1004 (open, 80,000) / O1005 (cancelled, 15,000) / O1023 |
| C004〜C010 | 高橋商店 ほか | bronze / silver / gold | 各 2〜4 件 |

| Product | name | category | stock |
|---|---|---|---|
| P001 | ボルト M8 | parts | 3 (restock 可) |
| P004 | トルクレンチ | tools | 6 (restock 可) |
| P006 | 研磨パッド | consumables | 8 (restock 可) |
| その他 5 点 | ナット M8, 電動ドリル, 潤滑油 1L, ベアリング 6204, 安全手袋 | | 12〜250 |

アクションは 4 つ: `cancel_order` (open のみ、`reason` 必須)、`ship_order` (open のみ)、`upgrade_tier` (gold 以外、bronze→silver→gold)、`restock` (stock < 10 のとき 100 に補充)。

## 3. Claude に投げるプロンプト例

### できること (そのまま通る)

**探索・読み取り**

- 「このオントロジーにはどんな型とアクションがある？」→ `describe_ontology` で全体像を答える
- 「Gold 顧客を一覧して」→ `search_objects(Customer, {tier: gold})`
- 「山田商事の注文を全部見せて」→ 名前で検索 → `traverse(places)`
- 「注文 O1003 は誰の注文？」→ `traverse` を逆方向にたどる
- 「注文 O1001 に何が入っている？」→ `traverse(contains)` で商品へ
- 「未出荷の注文の合計金額は？」→ `search_objects(Order, {status: open})` を Claude が集計

**アクション実行 (オーケストレーションの見せ場)**

- 「Gold 顧客の未出荷注文を『在庫欠品』を理由に全部キャンセルして」→ 検索 → 辿る → 1 件ずつ `cancel_order`
- 「O1004 を出荷済みにして」→ `ship_order`
- 「佐藤工業のティアを上げて」→ `upgrade_tier` (silver→gold)
- 「在庫が 10 未満の商品を全部補充して」→ `search_objects(Product)` を Claude が絞り込み → `restock`
- 「今回の操作の監査ログを確認したい」→ MCP には無いので、所有者は `/admin` で、それ以外は Claude が「管理画面を見てください」と答える

### できるけど「拒否される」のを見せるもの (設計どおりの挙動)

- 「O1002 をキャンセルして」→ 出荷済みなので precondition で失敗。Claude が理由を報告する
- 「O1005 を出荷済みにして」→ キャンセル済みなので同様に拒否
- 「山田商事のティアを上げて」→ すでに gold なので拒否
- 「ナット M8 を補充して」→ 在庫 250 で前提条件 (stock < 10) を満たさないので拒否
- 「理由なしで O1004 をキャンセルして」→ `reason` は必須パラメータなのでエラー。Claude が理由を聞き返すはず
- 「注文 O1001 のステータスを直接 'refunded' にして」→ `refunded` は enum にないうえ、そもそもプロパティを直接書き換えるツールが無い。「アクション経由でしか変更できない」ことの説明になる

precondition 不成立は `ok: false` と理由を返し、`audit_log` に `precondition_failed` として残ります。パラメータ不足・型違い・対象なしはツールエラーになり、`audit_log` に `error` と例外内容が残ります。どちらの場合も対象オブジェクトは変更されません。

### できないこと (今の最小構成の範囲外)

- **オブジェクトの新規作成・削除**: 「新しい顧客を登録して」は不可。`create_object` ツールが無い (意図的)
- **リンクの作成・削除**: 「この注文を佐藤工業に紐付けて」は不可
- **範囲・部分一致検索**: 「10 万円以上の注文」「名前に『工業』を含む顧客」は `search_objects` が完全一致のみなので、Claude が全件取ってから絞る形になる (`limit` の上限は 500)
- **複数オブジェクトにまたがる precondition**: 「顧客が gold のときだけキャンセル可」のような、リンク先を見る条件は書けない
- **アクションの一括実行・トランザクション**: 1 件ずつ実行なので、途中で失敗しても前の分はロールバックされない
- **権限モデル**: 認証は Google ログインのみ。所有者以外の利用者は全員同じ権限で、「誰が何をできるか」の細かい制御は無い
- **時間・履歴クエリ**: 「昨日キャンセルされた注文」は `/admin` の監査ログを目で追うか、D1 に直接 SQL を打つ必要がある

この「できない」リストがそのまま第 2 段階の候補です。特に範囲検索とリンク先を見る precondition は、`ontology.yaml` の語彙を少し広げるだけで足せます。

## 4. 公開ツール

| ツール | 説明 |
|---|---|
| `describe_ontology()` | 型・リンク・アクション一覧。Claude が最初に呼ぶ |
| `search_objects(type, filter, limit)` | プロパティ完全一致 (AND) で検索。`limit` は 1〜500 (既定 50) |
| `get_object(type, id)` | 1 件取得 |
| `traverse(type, id, link)` | リンクを順方向 / 逆方向にたどる |
| `execute_action(action, target_id, params)` | パラメータ検証 → precondition 検証 → effect 適用 → `audit_log` に記録。actor はログインした Google アカウントの email |
| `reset_sample_data()` | **所有者のみ**に表示。全データを消してサンプルを入れ直す |

## 5. YAML の語彙

- 型は `string integer number boolean enum`。`enum` は `values` を昇順に宣言する
- `preconditions`: `{property, op, value}` のリスト。op は `eq ne gt gte lt lte in contains`。比較できない組み合わせ (未設定プロパティに `gt` など) は不成立として扱う
- `effects`: `{property: value}`。値には `$params.<name>`, `$next_enum`, `$prev_enum` が使える。`$params` で参照した任意パラメータが省略された場合、そのプロパティは変更しない
- `parameters`: プロパティと同じ `{type, required, values}` で宣言する。未知のパラメータは拒否される

### 起動時の検証

`src/ontology/schema.ts` (zod) が読み込み時に次を検証し、違反があれば全件まとめて報告して起動 (デプロイ・テスト) を止めます:

- 未知のキー、未知の `type` / `op` / `cardinality`
- `enum` は空でない一意な `values` を持つこと。`values` は enum 以外に書けない
- `link_types` の `from` / `to`、`action_types` の `target` が `object_types` に存在すること
- `preconditions` / `effects` のプロパティが `target` に存在すること
- `$params.<name>` は `parameters` に宣言済みで、プロパティと同じ型であること。enum なら `values` が対象プロパティの部分集合であること
- `$next_enum` / `$prev_enum` は enum プロパティにのみ使えること
- リテラルの effect 値がプロパティの型に合うこと

### 「型を足してもコードは変わらない」を見せる

`ontology.yaml` に型・リンク・アクションを追記して push するだけです (GitHub 連携なら自動デプロイ、CLI なら `npm run deploy`) (`Product` / `contains` / `restock` はまさにそうやって足したものです)。インスタンスは `src/store/seed.ts` に足してリセットするか、D1 に直接 INSERT します:

```bash
npx wrangler d1 execute ontology --remote --command \
  "INSERT INTO objects (type, id, props) VALUES ('Product', 'P009', '{\"name\":\"ワッシャー\",\"stock\":5,\"price\":30,\"category\":\"parts\"}')"
```

## 6. 自分でデプロイする (ダッシュボードだけで完結)

必要なもの: Cloudflare アカウント (Workers Free で足ります)、Google Cloud のプロジェクト、このリポジトリの fork または clone。`wrangler` コマンドは不要です。

### 6.1 所有者とアプリ名を設定する

`wrangler.jsonc` の `vars.OWNER_EMAIL` を自分の Google アカウントに、`vars.APP_NAME` を Google の OAuth 同意画面に登録するアプリ名 (既定: `Ontology Demo Service`) に合わせて push します。管理画面とリセットは `OWNER_EMAIL` のアカウントだけに許可され、`APP_NAME` はトップページ・プライバシーポリシー・利用規約・承認ダイアログに表示されます (Google の審査ではホームページのアプリ名と同意画面のアプリ名の一致が求められます)。

### 6.2 Cloudflare: GitHub 連携でデプロイする

1. Cloudflare ダッシュボード → **Workers & Pages** → **Create** → **Import a repository** で GitHub を接続し、このリポジトリを選ぶ
2. Worker 名は `wrangler.jsonc` の `name` と同じ **`ontology-mcp`** にする (一致しないとビルドが失敗する)。ビルドコマンドは空、デプロイコマンドは既定の `npx wrangler deploy` のまま
3. **Deploy** を押す。初回デプロイで KV (`OAUTH_KV`) と D1 (`ontology`) が自動作成される (`wrangler.jsonc` に id を書いていないため)
4. デプロイ後に表示される URL `https://ontology-mcp.<あなたのサブドメイン>.workers.dev` を控える。サブドメインは Workers & Pages の画面右側 **Your subdomain** にも出ているので、先に知りたければそこで確認できる

以後は `main` に push するたびに自動でデプロイされます。

### 6.3 Google: OAuth クライアントを作る

Google Cloud Console → API とサービス → 認証情報 → **OAuth クライアント ID** (ウェブ アプリケーション) を作成し、承認済みリダイレクト URI に 6.2 で控えた URL を使って次を登録します:

```
https://ontology-mcp.<サブドメイン>.workers.dev/callback          # MCP クライアント向けログイン
https://ontology-mcp.<サブドメイン>.workers.dev/admin/callback    # 管理画面向けログイン
```

OAuth 同意画面は「外部」にし、公開するかテストユーザーを登録します。リダイレクト URI は後から追加・編集できるので、ローカル開発用 (`http://localhost:8788/callback`, `http://localhost:8788/admin/callback`) は必要になったときに足せば十分です。

同意画面の「アプリのホームページ」「アプリのプライバシーポリシー」「アプリの利用規約」には Worker が配信する次のページを指定します (内容は `src/home.ts` と `src/legal/pages.ts`。日本語と英語を併記し、アプリ名と運営者のメールアドレスは `APP_NAME` / `OWNER_EMAIL` から入ります):

```
https://ontology-mcp.<サブドメイン>.workers.dev/          # ホームページ (ログイン不要で目的・機能・データの扱いを説明)
https://ontology-mcp.<サブドメイン>.workers.dev/privacy   # プライバシーポリシー
https://ontology-mcp.<サブドメイン>.workers.dev/terms     # 利用規約
```

アプリを「公開」して Google の検証を受ける場合は、承認済みドメインとして `<サブドメイン>.workers.dev` を Search Console で所有権確認する必要があります。HTML タグ方式の `content` 値を Worker の変数 `GOOGLE_SITE_VERIFICATION` に入れると、トップページに `<meta name="google-site-verification">` が出力されます。テストユーザーだけで使う間は不要です。

### 6.3.1 トップページの画像とリンクカード (OGP)

トップページは OGP と Twitter Card のメタタグ (`og:title`, `og:description`, `og:image`, `twitter:card=summary_large_image` など) を出力するので、X や note.com にリンクを貼ると画像付きのカードになります。画像を差し替える場合は `public/hero.jpg` (ページ表示用、1600×900) と `public/og-image.jpg` (カード用、1200×630、1 MB 未満推奨) を置き換えて push します。カードのキャッシュは各サービス側にあるため、差し替え直後は古い画像が表示されることがあります (X は [Card Validator](https://cards-dev.twitter.com/validator) 相当の再取得、note は記事の再保存で更新されます)。

### 6.4 Cloudflare: シークレットを登録する

Worker の **Settings → Variables & Secrets** で次の 3 つを **Secret** として追加します (保存すると即座に反映され、再デプロイは不要):

| 名前 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | 6.3 のクライアント ID |
| `GOOGLE_CLIENT_SECRET` | 6.3 のクライアント シークレット |
| `COOKIE_ENCRYPTION_KEY` | ランダムな 64 桁の 16 進文字列 (`openssl rand -hex 32` など) |

### 6.5 初期化して接続する

1. `https://ontology-mcp.<サブドメイン>.workers.dev/admin` を開き、所有者の Google アカウントでログインする
2. **サンプルデータをリセット** を押す。テーブル作成 (`migrations/0001_init.sql` と同じ内容) とサンプルデータ投入がここで行われる
3. `claude mcp add --transport http ontology https://ontology-mcp.<サブドメイン>.workers.dev/mcp` で接続し、`/mcp` から Google ログインして README 3 章のプロンプトを試す

### 6.6 代わりに wrangler CLI でデプロイする場合

```bash
npm install
npx wrangler login
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
npm run deploy                  # KV / D1 が無ければ自動作成され、id が wrangler.jsonc に書き戻される
npm run db:migrate:remote       # または /admin のリセットで代用
npm run db:seed:remote          # 同上
```

## 7. ローカル開発

```bash
cp .dev.vars.example .dev.vars        # Google のローカル用クライアント ID/Secret と COOKIE_ENCRYPTION_KEY を入れる
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev                            # http://localhost:8788
claude mcp add --transport http ontology-local http://localhost:8788/mcp
```

`.dev.vars` はダミー値でも Worker は起動します (Google ログインだけ失敗します)。`/`, `/.well-known/oauth-authorization-server`, `/admin` はログインなしで確認できます。

## 8. テスト

```bash
npm test                # vitest (Workers ランタイム上で実行、D1 は Miniflare)
npm run test:coverage   # 80% 未満なら失敗
npm run type-check
```

- `test/ontology.test.ts` / `test/actions.test.ts`: スキーマ検証と precondition / effect の純粋関数
- `test/store.test.ts`: D1 に対する検索・トラバース・アクション実行・楽観ロックの競合・監査
- `test/mcp.test.ts`: インメモリ transport で MCP Client から 6 ツールを呼ぶ (所有者 / 一般ユーザーの可視性を含む)
- `test/admin.test.ts`: Worker 全体を `SELF.fetch` で叩く (管理画面のアクセス制御、Google コールバック、CSRF、`/mcp` の 401、OAuth メタデータ)

## 9. 設計メモ

- **認証の二本立て**: MCP クライアントは OAuth 2.1 + Dynamic Client Registration (`/authorize`, `/token`, `/register`) で、`workers-oauth-provider` が Google ログインを代理する。ブラウザの管理画面は同じ Google クライアントで別途ログインし、HMAC 署名 Cookie (`Path=/admin`) を持つ。Cloudflare Access は `/mcp` の OAuth を壊すので使わない
- **楽観ロック**: D1 には `FOR UPDATE` が無いので、読んだ `props` テキストと一致する行だけを UPDATE し、0 件なら読み直して最大 3 回試す。監査行は同じバッチで `WHERE changes() = 1` を付けて INSERT するので、空振りしたときに残らない
- **共有データ**: 全利用者で 1 つのデータ。監査ログの actor に Google の email が入るので「誰が」は追える
- **wrangler 不要のデプロイ**: `wrangler.jsonc` に KV / D1 の id を書かず自動プロビジョニングに任せ、テーブル作成は `/admin` のリセット (`src/store/schema.ts` が `migrations/0001_init.sql` を同梱して実行) が兼ねる。ダッシュボードの GitHub 連携だけで公開できる
- **無料枠の目安**: Workers Free (10 万 req/日)、KV (書き込み 1,000/日: OAuth のログイン・更新で消費)、D1 (読み 500 万/日)。デモ利用なら十分

## 10. 次の段階

- `search_objects` に範囲・部分一致条件 (`amount gte 100000`、`name contains 工業`) を足す
- リンク先を見る precondition (「顧客が gold のときだけ」) を YAML の語彙に加える
- `create_object` / `link_objects` ツールで新規作成と紐付けを Claude から行えるようにする
- 監査ログを Grafana などに流して「誰が・どの型に・何をした」を可視化する
- 判断ロジック (与信など) を別プロセスのエージェントにし、A2A で Claude から呼ぶ

## ライセンス

[MIT License](LICENSE)
