/**
 * プライバシーポリシーと利用規約。
 * Google の OAuth 同意画面 (アプリのプライバシーポリシー / 利用規約リンク) に貼るための公開ページ。
 * 内容はこのデモが実際に扱う情報 (Google アカウントの email・名前、操作の監査ログ、共有サンプルデータ) に合わせている。
 */
import { esc, page } from "../admin/views";

export const LEGAL_EFFECTIVE_DATE = "2026-09-15";

type LegalContext = { serviceUrl: string; ownerEmail: string };

const footer = (ctx: LegalContext): string =>
  `<p class="muted">施行日: ${LEGAL_EFFECTIVE_DATE} / 運営者連絡先: <a href="mailto:${esc(ctx.ownerEmail)}">${esc(ctx.ownerEmail)}</a> / ` +
  `<a href="/">トップ</a> · <a href="/privacy">プライバシーポリシー</a> · <a href="/terms">利用規約</a></p>`;

export function privacyPage(ctx: LegalContext): string {
  return page(
    "プライバシーポリシー - ontology-mcp",
    `<h1>プライバシーポリシー</h1>
<p>ontology-mcp (以下「本サービス」、URL: <a href="${esc(ctx.serviceUrl)}">${esc(ctx.serviceUrl)}</a>) は、YAML で宣言したオントロジーを
MCP (Model Context Protocol) サーバーとして公開する技術デモです。本サービスは個人 (以下「運営者」) が運営しています。
本ポリシーは、本サービスが利用者の情報をどのように取り扱うかを定めます。</p>

<h2>1. 取得する情報</h2>
<ul>
  <li><strong>Google アカウント情報</strong>: Google でログインした際に、メールアドレス、氏名、Google アカウント ID を取得します (スコープ: email, profile)。</li>
  <li><strong>操作ログ</strong>: 本サービスのツール (アクションの実行、サンプルデータのリセット) を利用した際に、実行者のメールアドレス、実行したアクション、対象、変更前後の値、結果、日時を監査ログとして記録します。</li>
  <li><strong>認可情報</strong>: MCP クライアント (Claude Code、Claude Desktop など) と本サービスの間の OAuth 2.1 認可に必要なトークンとクライアント登録情報。Google から受け取ったアクセストークンは暗号化して保存し、上記アカウント情報の取得にのみ使用します。</li>
  <li><strong>Cookie</strong>: ログイン状態の維持と CSRF 対策のために、署名付き Cookie を使用します。広告や行動追跡には使用しません。</li>
</ul>

<h2>2. 利用目的</h2>
<ul>
  <li>利用者を識別し、本サービスへのアクセスを認可するため</li>
  <li>誰がどのデータをどう変更したかを監査ログとして記録し、デモの動作を示すため</li>
  <li>運営者 (${esc(ctx.ownerEmail)}) のみが利用できる管理機能 (データの一覧・リセット) を提供するため</li>
</ul>

<h2>3. 保存場所と保存期間</h2>
<ul>
  <li>情報は Cloudflare のサービス (Workers、D1、KV) 上に保存されます。</li>
  <li>監査ログは、運営者がサンプルデータをリセットするまで保存され、リセット時にすべて削除されます。</li>
  <li>OAuth の認可情報は、トークンの有効期限切れ、または利用者が MCP クライアント側で接続を解除するまで保存されます。</li>
  <li>削除を希望される場合は、下記連絡先までご連絡ください。</li>
</ul>

<h2>4. 第三者への提供</h2>
<p>取得した情報を第三者に販売・提供することはありません。ただし、本サービスのデータは利用者間で共有されるデモ用データであり、
アクションを実行すると監査ログに記録されたメールアドレスが運営者に閲覧されます。法令に基づく開示要請があった場合を除き、他の目的には使用しません。</p>

<h2>5. Google ユーザーデータの取り扱い</h2>
<p>本サービスによる Google API から取得した情報の利用は、
<a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>
(限定的な使用の要件を含む) に従います。Google アカウント情報は、上記 2. の目的以外には使用せず、広告目的での利用や人による閲覧 (運営者による監査ログの確認を除く) は行いません。
利用者は <a href="https://myaccount.google.com/permissions" rel="noopener">Google アカウントの設定</a> からいつでも本サービスのアクセス権を取り消せます。</p>

<h2>6. 安全管理</h2>
<p>通信はすべて HTTPS で暗号化されます。認可情報は暗号化して保存し、管理機能は運営者の Google アカウントによる認証で保護しています。</p>

<h2>7. 本ポリシーの変更</h2>
<p>本ポリシーは予告なく変更されることがあります。変更後の内容は本ページに掲載した時点から適用されます。</p>

<h2>8. 連絡先</h2>
<p>本ポリシーに関するお問い合わせは <a href="mailto:${esc(ctx.ownerEmail)}">${esc(ctx.ownerEmail)}</a> までお願いします。</p>
${footer(ctx)}`,
  );
}

export function termsPage(ctx: LegalContext): string {
  return page(
    "利用規約 - ontology-mcp",
    `<h1>利用規約</h1>
<p>本規約は、ontology-mcp (以下「本サービス」、URL: <a href="${esc(ctx.serviceUrl)}">${esc(ctx.serviceUrl)}</a>) の利用条件を定めるものです。
本サービスを利用することで、利用者は本規約に同意したものとみなします。</p>

<h2>1. 本サービスの性質</h2>
<p>本サービスは、YAML で宣言したオントロジーを MCP サーバーとして公開する<strong>技術デモ</strong>であり、個人 (以下「運営者」) が無償で提供します。
業務利用や本番用途を想定したものではありません。</p>

<h2>2. 利用条件</h2>
<ul>
  <li>利用には Google アカウントによるログインが必要です。</li>
  <li>利用者は、本サービスの MCP ツールを自身の MCP クライアント (Claude Code、Claude Desktop など) から利用できます。</li>
  <li>管理機能 (データの一覧・リセット) は運営者のみが利用できます。</li>
</ul>

<h2>3. 共有データについて</h2>
<ul>
  <li>本サービスのデータは架空のサンプルデータであり、<strong>すべての利用者の間で共有</strong>されます。利用者が行った操作は他の利用者にも見えます。</li>
  <li>データは運営者の判断で予告なくリセットされることがあります。</li>
  <li>本サービスに個人情報、機密情報、その他公開されて困る情報を入力しないでください。</li>
</ul>

<h2>4. 禁止事項</h2>
<ul>
  <li>本サービスや他の利用者に過度な負荷をかける行為、自動化された大量アクセス</li>
  <li>本サービスの認証や認可の仕組みを回避・攻撃する行為</li>
  <li>法令または公序良俗に反する行為、第三者の権利を侵害する行為</li>
</ul>

<h2>5. 免責事項</h2>
<ul>
  <li>本サービスは「現状有姿」で提供され、運営者は正確性、完全性、可用性、特定目的への適合性について一切保証しません。</li>
  <li>運営者は、本サービスの利用または利用不能によって生じたいかなる損害についても責任を負いません。</li>
  <li>本サービスは Cloudflare および Google のサービスに依存しており、それらの障害や仕様変更により利用できなくなることがあります。</li>
</ul>

<h2>6. サービスの変更・停止</h2>
<p>運営者は、予告なく本サービスの内容を変更し、または提供を停止・終了することができます。</p>

<h2>7. プライバシー</h2>
<p>利用者の情報の取り扱いは <a href="/privacy">プライバシーポリシー</a> に定めます。</p>

<h2>8. 規約の変更と準拠法</h2>
<p>本規約は予告なく変更されることがあり、変更後の規約は本ページに掲載した時点から適用されます。本規約は日本法に準拠します。</p>

<h2>9. 連絡先</h2>
<p>本規約に関するお問い合わせは <a href="mailto:${esc(ctx.ownerEmail)}">${esc(ctx.ownerEmail)}</a> までお願いします。</p>
${footer(ctx)}`,
  );
}
