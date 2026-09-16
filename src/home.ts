/**
 * トップページ (Google OAuth 同意画面の「アプリのホームページ」)。
 * ログイン不要で、アプリ名 (同意画面と同じ APP_NAME)、目的、機能、使い方、Google アカウント情報の扱いを説明する。
 * 管理画面へのリンクは置かない (ログイン画面がホームページと見なされるのを避ける)。
 * OGP / Twitter Card のメタタグを出し、X や note.com でリンクを貼ったときに画像付きカードが表示されるようにする。
 * 画像は public/ の静的アセット (wrangler.jsonc の assets.directory) から配信される。
 */
import { esc, page } from "./admin/views";

export const REPOSITORY_URL = "https://github.com/sho7650/ontology-cloud";
export const OG_IMAGE_PATH = "/og-image.jpg"; // 1200×630
export const HERO_IMAGE_PATH = "/hero.jpg"; // 1600×900

export type HomeContext = {
  appName: string;
  /** サイトのルート URL (末尾スラッシュあり)。OGP の絶対 URL に使う */
  siteUrl: string;
  mcpUrl: string;
  ownerEmail: string;
  siteVerification?: string;
};

export const homeDescription = (appName: string): string =>
  `${appName} は、YAML で宣言したオントロジー (データの型・関係・操作のルール) を MCP サーバーとして公開し、` +
  "Claude などの AI アシスタントから自然言語で探索・操作できるようにする技術デモです。Google アカウントでログインすれば誰でも試せます。";

/** OGP / Twitter Card / description。画像 URL は絶対 URL でないとクローラーが解決できない。 */
export function socialMetaTags(ctx: Pick<HomeContext, "appName" | "siteUrl">): string {
  const description = esc(homeDescription(ctx.appName));
  const image = esc(new URL(OG_IMAGE_PATH, ctx.siteUrl).href);
  const app = esc(ctx.appName);
  return [
    `<meta name="description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${app}">`,
    `<meta property="og:title" content="${app}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${esc(ctx.siteUrl)}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:alt" content="${app}">`,
    `<meta property="og:locale" content="ja_JP">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${app}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<link rel="canonical" href="${esc(ctx.siteUrl)}">`,
  ].join("");
}

export function homePage(ctx: HomeContext): string {
  const app = esc(ctx.appName);
  const verification = ctx.siteVerification
    ? `<meta name="google-site-verification" content="${esc(ctx.siteVerification)}">`
    : "";
  return page(
    ctx.appName,
    `<h1>${app}</h1>
<p><img src="${HERO_IMAGE_PATH}" alt="${app}: 宣言されたオントロジーの世界を AI アシスタントと一緒に探索するイメージ" width="1600" height="900" style="max-width: 100%; height: auto; border-radius: 8px; display: block;"></p>
<p><strong>${app}</strong> は、YAML で宣言したオントロジー (データの型・関係・操作のルール) を
<a href="https://modelcontextprotocol.io/" rel="noopener">MCP (Model Context Protocol)</a> サーバーとして公開し、
Claude などの AI アシスタントから自然言語で探索・操作できるようにする技術デモです。
Cloudflare Workers 上で動作し、Google アカウントでログインすれば誰でも自分の Claude から試せます。</p>

<h2>このアプリの目的</h2>
<ul>
  <li>「型を YAML に宣言するだけで、AI がその世界を探索し、ルールに従って操作できる」ことを示す</li>
  <li>データの変更は宣言されたアクション経由でしか行えず、前提条件 (例: 出荷済みの注文はキャンセルできない) がサーバー側で強制されることを体験する</li>
  <li>誰が・何を・どう変更したかが監査ログに残る仕組みを見せる</li>
</ul>

<h2>できること</h2>
<p>架空の受注管理データ (顧客 10 社、注文 30 件、商品 8 点) に対して、次の 5 つの MCP ツールを提供します。</p>
<table>
  <tr><th>ツール</th><th>説明</th></tr>
  <tr><td><code>describe_ontology</code></td><td>型・リンク・アクションの一覧を返す</td></tr>
  <tr><td><code>search_objects</code></td><td>プロパティの完全一致でオブジェクトを検索する</td></tr>
  <tr><td><code>get_object</code></td><td>オブジェクトを 1 件取得する</td></tr>
  <tr><td><code>traverse</code></td><td>リンクをたどって関連オブジェクトを取得する (顧客 → 注文 → 商品)</td></tr>
  <tr><td><code>execute_action</code></td><td>宣言されたアクション (注文のキャンセル・出荷、顧客ティアの昇格、在庫補充) を前提条件付きで実行する</td></tr>
</table>
<p>例: 「Gold 顧客の未出荷注文を『在庫欠品』を理由に全部キャンセルして」と Claude に依頼すると、検索 → リンクをたどる → 1 件ずつアクション実行、という手順を Claude が組み立てます。出荷済みの注文は前提条件で拒否され、その理由が報告されます。</p>

<h2>使い方</h2>
<ol>
  <li>Claude Code で次のコマンドを実行して MCP サーバーを登録します。<pre>claude mcp add --transport http ontology ${esc(ctx.mcpUrl)}</pre>
      Claude Desktop の場合は Settings → Connectors から同じ URL を追加します。</li>
  <li>Claude から接続すると Google のログイン画面が開くので、Google アカウントでログインし、アクセスを承認します。</li>
  <li>「このオントロジーにはどんな型とアクションがある？」「山田商事の注文を全部見せて」などと Claude に話しかけます。</li>
</ol>

<h2>Google アカウント情報の扱い</h2>
<p>ログイン時に取得するのはメールアドレスと氏名 (スコープ <code>email</code>, <code>profile</code>) だけで、利用者の識別と操作ログの記録にのみ使用します。
Gmail や Drive など他の Google データにはアクセスしません。データは利用者全員で共有される架空のサンプルで、運営者の判断でリセットされます。
詳細は <a href="/privacy">プライバシーポリシー</a> と <a href="/terms">利用規約</a> をご覧ください。
アクセス権は <a href="https://myaccount.google.com/permissions" rel="noopener">Google アカウントの設定</a> からいつでも取り消せます。</p>

<h2>ソースコードと連絡先</h2>
<p>このアプリはオープンソースです: <a href="${REPOSITORY_URL}" rel="noopener">${REPOSITORY_URL}</a>。
オントロジーの定義 (<code>ontology.yaml</code>) を書き換えるだけで、別のデータモデルにも同じ仕組みを適用できます。</p>
<p>運営者: <a href="mailto:${esc(ctx.ownerEmail)}">${esc(ctx.ownerEmail)}</a></p>
<p class="muted"><a href="/privacy">プライバシーポリシー / Privacy Policy</a> · <a href="/terms">利用規約 / Terms of Service</a></p>`,
    verification + socialMetaTags(ctx),
  );
}
