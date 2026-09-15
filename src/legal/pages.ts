/**
 * プライバシーポリシーと利用規約 (日本語 + 英語)。
 * Google の OAuth 同意画面 (アプリのプライバシーポリシー / 利用規約リンク) に貼る公開ページ。
 * 内容はこのデモが実際に扱う情報に合わせている。アプリ名は同意画面の名前 (APP_NAME) と一致させる。
 */
import { esc, page } from "../admin/views";

export const LEGAL_EFFECTIVE_DATE = "2026-09-15";

export type LegalContext = { appName: string; serviceUrl: string; ownerEmail: string };

const nav = (ctx: LegalContext): string =>
  `<p class="muted"><a href="/">${esc(ctx.appName)}</a> · <a href="/privacy">プライバシーポリシー / Privacy Policy</a> · <a href="/terms">利用規約 / Terms of Service</a></p>`;

const contact = (ctx: LegalContext): string => `<a href="mailto:${esc(ctx.ownerEmail)}">${esc(ctx.ownerEmail)}</a>`;

export function privacyPage(ctx: LegalContext): string {
  const app = esc(ctx.appName);
  const url = esc(ctx.serviceUrl);
  return page(
    `プライバシーポリシー / Privacy Policy - ${ctx.appName}`,
    `${nav(ctx)}
<h1>${app} プライバシーポリシー</h1>
<p class="muted">施行日 / Effective date: ${LEGAL_EFFECTIVE_DATE}。英語版は下部にあります。The English version follows the Japanese text.</p>

<p>${app} (以下「本サービス」、URL: <a href="${url}">${url}</a>) は、YAML で宣言したオントロジー (データの型・関係・操作のルール) を
MCP (Model Context Protocol) サーバーとして公開し、Claude などの AI アシスタントから利用できるようにする技術デモです。
本サービスは個人 (以下「運営者」) が運営しています。本ポリシーは、本サービスが利用者の情報をどのように取得・利用・保存・共有するかを説明します。</p>

<h2>1. 取得する情報</h2>
<h3>1.1 Google アカウント情報</h3>
<p>利用者が Google でログインすると、本サービスは Google の OAuth 2.0 を通じて次のスコープを要求し、以下の情報を取得します。</p>
<table>
  <tr><th>スコープ</th><th>取得する情報</th><th>用途</th></tr>
  <tr><td><code>email</code></td><td>メールアドレス</td><td>利用者の識別、操作ログの記録者の特定、運営者かどうかの判定</td></tr>
  <tr><td><code>profile</code></td><td>氏名、Google アカウント ID、プロフィール画像の URL</td><td>MCP クライアントに表示する接続名 (氏名) と、利用者の識別 (ID)。プロフィール画像は保存しません</td></tr>
</table>
<p>これら以外の Google データ (Gmail、Drive、カレンダーなど) には一切アクセスしません。</p>

<h3>1.2 利用者の操作に関する情報</h3>
<ul>
  <li><strong>監査ログ</strong>: 本サービスのアクションを実行 (例: 注文のキャンセル、サンプルデータのリセット) すると、実行者のメールアドレス、アクション名、対象オブジェクト、変更前後の値、結果 (成功 / 前提条件不成立 / エラー)、日時を記録します。</li>
  <li><strong>認可情報</strong>: 利用者の MCP クライアント (Claude Code、Claude Desktop など) と本サービスの間の OAuth 2.1 認可に必要な、クライアント登録情報、認可コード、アクセストークン、リフレッシュトークン。Google から受け取ったアクセストークンも、これらに紐づけて暗号化して保存します。</li>
  <li><strong>Cookie</strong>: Google ログイン中の CSRF 対策 (state) と、運営者向け管理画面のログイン状態維持のために、署名付き Cookie を使用します。広告や行動追跡には使用しません。</li>
  <li><strong>アクセスログ</strong>: 本サービスは Cloudflare Workers 上で動作しており、Cloudflare が IP アドレスやリクエスト情報を含む標準的なアクセスログを一時的に処理します。運営者はこれらを個人の特定には使用しません。</li>
</ul>

<h2>2. 情報の利用目的</h2>
<ul>
  <li>利用者を認証し、本サービスの MCP ツールへのアクセスを認可するため</li>
  <li>「誰が、どのデータを、どう変更したか」を監査ログとして記録し、本サービスの仕組み (アクション経由でしか変更できず、履歴が残ること) をデモとして示すため</li>
  <li>運営者 (${contact(ctx)}) だけが使える管理機能 (データの一覧・サンプルデータのリセット) へのアクセスを制限するため</li>
  <li>不正利用や障害への対応のため</li>
</ul>
<p>取得した情報を広告、マーケティング、プロファイリング、利用者の信用判断に使用することはありません。</p>

<h2>3. 保存場所・保存期間・削除</h2>
<ul>
  <li><strong>保存場所</strong>: すべての情報は Cloudflare のサービス (Workers、D1 データベース、KV ストレージ) 上に保存されます。</li>
  <li><strong>監査ログ</strong>: 運営者がサンプルデータをリセットするまで保存され、リセット時にすべて削除されます。デモ用途のため、リセットは予告なく行われます。</li>
  <li><strong>認可情報</strong>: アクセストークンは有効期限 (発行から 1 時間) で失効します。リフレッシュトークンとクライアント登録情報は、利用者が MCP クライアント側で接続を解除するか、Google アカウント側でアクセス権を取り消すか、運営者が削除するまで保存されます。</li>
  <li><strong>削除の請求</strong>: 利用者は ${contact(ctx)} 宛てに連絡することで、自身のメールアドレスを含む監査ログと認可情報の削除を請求できます。運営者は合理的な期間内 (原則 30 日以内) に削除します。</li>
</ul>

<h2>4. 第三者への提供・共有</h2>
<ul>
  <li>取得した情報を第三者に販売、貸与、提供することはありません。</li>
  <li>本サービスのサンプルデータは利用者間で共有されます。利用者がアクションを実行すると、監査ログに記録されたメールアドレスを<strong>運営者が管理画面で閲覧できます</strong>。他の利用者に利用者のメールアドレスが表示されることはありません。</li>
  <li>情報の保存・処理のために Cloudflare, Inc. のインフラを利用します (データ処理の委託)。</li>
  <li>法令に基づく開示要請がある場合を除き、上記以外の目的で情報を開示しません。</li>
</ul>

<h2>5. Google ユーザーデータの取り扱い (Google API Services User Data Policy)</h2>
<p>本サービスによる Google API から取得した情報の利用と他のアプリへの転送は、
<a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>
(限定的な使用 (Limited Use) の要件を含む) に従います。具体的には次を約束します。</p>
<ul>
  <li>Google ユーザーデータは、本ポリシー 2. に記載した本サービスの機能提供と改善のためにのみ使用します。</li>
  <li>Google ユーザーデータを広告目的で使用したり、広告事業者やデータブローカーに転送したりしません。</li>
  <li>Google ユーザーデータを人が閲覧するのは、運営者が監査ログを確認する場合、利用者の同意がある場合、セキュリティ調査や法令遵守のために必要な場合に限ります。</li>
</ul>

<h2>6. 利用者の権利とアクセス権の取り消し</h2>
<ul>
  <li><a href="https://myaccount.google.com/permissions" rel="noopener">Google アカウントの「サードパーティ製のアプリとサービス」</a> から、いつでも本サービスのアクセス権を取り消せます。</li>
  <li>MCP クライアント側で本サービスとの接続を削除すると、そのクライアントに発行した認可情報は使用できなくなります。</li>
  <li>保存されている自身の情報の開示・訂正・削除は、${contact(ctx)} までご請求ください。</li>
</ul>

<h2>7. 安全管理措置</h2>
<ul>
  <li>通信はすべて HTTPS (TLS) で暗号化されます。</li>
  <li>OAuth の認可情報とそれに紐づく Google のアクセストークンは暗号化して保存します。</li>
  <li>運営者向けの管理機能は、運営者の Google アカウントによる認証と、署名付き Cookie、CSRF トークンで保護しています。</li>
  <li>ソースコードは公開されており、誰でも処理内容を確認できます。</li>
</ul>

<h2>8. 児童のプライバシー</h2>
<p>本サービスは 13 歳未満 (または各国の法令が定める年齢未満) の児童を対象としておらず、児童の情報を意図的に取得しません。</p>

<h2>9. 本ポリシーの変更</h2>
<p>本ポリシーは変更されることがあります。重要な変更がある場合は、本ページの施行日を更新して掲載します。変更後の内容は掲載時点から適用されます。</p>

<h2>10. 連絡先</h2>
<p>本ポリシー、または本サービスにおける情報の取り扱いに関するお問い合わせ・削除請求は、運営者 (${contact(ctx)}) までお願いします。</p>

<hr>

<h1>${app} Privacy Policy (English)</h1>
<p>${app} ("the Service", <a href="${url}">${url}</a>) is a technical demo that exposes an ontology declared in YAML (data types, relations and action rules) as a
Model Context Protocol (MCP) server so AI assistants such as Claude can use it. The Service is operated by an individual ("the Operator").
This policy explains what information the Service collects, how it is used, stored and shared, and how you can delete it.</p>

<h2>1. Information we collect</h2>
<h3>1.1 Google account information</h3>
<p>When you sign in with Google, the Service requests the following OAuth scopes:</p>
<table>
  <tr><th>Scope</th><th>Data</th><th>Purpose</th></tr>
  <tr><td><code>email</code></td><td>Email address</td><td>Identify you, record who performed each action in the audit log, determine whether you are the Operator</td></tr>
  <tr><td><code>profile</code></td><td>Name, Google account ID, profile picture URL</td><td>Label your MCP connection (name) and identify you (ID). The profile picture is not stored</td></tr>
</table>
<p>The Service does not access any other Google data (Gmail, Drive, Calendar, etc.).</p>
<h3>1.2 Usage information</h3>
<ul>
  <li><strong>Audit log</strong>: when you execute an action (for example cancelling an order or resetting the sample data) we record your email address, the action, the target object, the values before and after, the result and the timestamp.</li>
  <li><strong>Authorization data</strong>: OAuth 2.1 client registrations, authorization codes, access tokens and refresh tokens issued to your MCP client (Claude Code, Claude Desktop, etc.), and the Google access token, stored encrypted.</li>
  <li><strong>Cookies</strong>: signed cookies for CSRF protection during Google sign-in and for the Operator's admin session. No advertising or tracking cookies.</li>
  <li><strong>Access logs</strong>: the Service runs on Cloudflare Workers, which transiently processes standard request logs including IP addresses. The Operator does not use them to identify individuals.</li>
</ul>

<h2>2. How we use information</h2>
<ul>
  <li>To authenticate you and authorize access to the Service's MCP tools</li>
  <li>To keep an audit log of who changed what, which is part of what the demo demonstrates</li>
  <li>To restrict the admin features (listing and resetting data) to the Operator (${contact(ctx)})</li>
  <li>To investigate abuse and failures</li>
</ul>
<p>We do not use your information for advertising, marketing, profiling or creditworthiness decisions.</p>

<h2>3. Storage, retention and deletion</h2>
<ul>
  <li>All data is stored on Cloudflare (Workers, D1, KV).</li>
  <li>The audit log is kept until the Operator resets the sample data, which deletes it entirely. Resets happen without notice.</li>
  <li>Access tokens expire one hour after issuance. Refresh tokens and client registrations are kept until you disconnect the Service in your MCP client, revoke access in your Google account, or the Operator deletes them.</li>
  <li>You may request deletion of your audit log entries and authorization data by emailing ${contact(ctx)}. Requests are honoured within 30 days.</li>
</ul>

<h2>4. Sharing</h2>
<ul>
  <li>We do not sell, rent or share your information with third parties.</li>
  <li>The sample data is shared between all users. When you execute an action, the Operator can see your email address in the audit log through the admin page. Other users never see your email address.</li>
  <li>Cloudflare, Inc. processes data on our behalf as the hosting provider.</li>
  <li>We disclose information only when required by law.</li>
</ul>

<h2>5. Google API Services User Data Policy</h2>
<p>${app}'s use and transfer to any other app of information received from Google APIs will adhere to the
<a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>, including the Limited Use requirements.
Google user data is only used to provide and improve the features described in section 2, is never used for advertising or transferred to advertisers or data brokers,
and is only read by a human when the Operator reviews the audit log, with your consent, or when necessary for security or legal compliance.</p>

<h2>6. Your rights and revoking access</h2>
<ul>
  <li>Revoke the Service's access at any time from <a href="https://myaccount.google.com/permissions" rel="noopener">your Google account's third-party access page</a>.</li>
  <li>Removing the Service from your MCP client invalidates the authorization data issued to that client.</li>
  <li>Contact ${contact(ctx)} to access, correct or delete your data.</li>
</ul>

<h2>7. Security</h2>
<p>All traffic is encrypted with HTTPS. Authorization data and Google tokens are stored encrypted. Admin features are protected by the Operator's Google sign-in, signed cookies and CSRF tokens. The source code is public.</p>

<h2>8. Children</h2>
<p>The Service is not directed to children under 13 (or the applicable age in your country) and does not knowingly collect their data.</p>

<h2>9. Changes</h2>
<p>We may update this policy. Material changes are announced by updating the effective date on this page.</p>

<h2>10. Contact</h2>
<p>Questions and deletion requests: ${contact(ctx)}.</p>
${nav(ctx)}`,
  );
}

export function termsPage(ctx: LegalContext): string {
  const app = esc(ctx.appName);
  const url = esc(ctx.serviceUrl);
  return page(
    `利用規約 / Terms of Service - ${ctx.appName}`,
    `${nav(ctx)}
<h1>${app} 利用規約</h1>
<p class="muted">施行日 / Effective date: ${LEGAL_EFFECTIVE_DATE}。英語版は下部にあります。The English version follows the Japanese text.</p>
<p>本規約は、${app} (以下「本サービス」、URL: <a href="${url}">${url}</a>) の利用条件を定めるものです。本サービスを利用することで、利用者は本規約に同意したものとみなします。</p>

<h2>1. 本サービスの性質</h2>
<p>本サービスは、YAML で宣言したオントロジーを MCP サーバーとして公開する<strong>技術デモ</strong>であり、個人 (以下「運営者」) が無償で提供します。業務利用や本番用途を想定したものではありません。</p>

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
<p>本規約に関するお問い合わせは ${contact(ctx)} までお願いします。</p>

<hr>

<h1>${app} Terms of Service (English)</h1>
<p>These terms govern your use of ${app} ("the Service", <a href="${url}">${url}</a>). By using the Service you agree to them.</p>
<h2>1. Nature of the Service</h2>
<p>The Service is a free <strong>technical demo</strong>, operated by an individual ("the Operator"), that exposes a YAML-declared ontology as an MCP server. It is not intended for business or production use.</p>
<h2>2. Eligibility and access</h2>
<ul>
  <li>Signing in with a Google account is required.</li>
  <li>You may use the Service's MCP tools from your own MCP client (Claude Code, Claude Desktop, etc.).</li>
  <li>Admin features (listing and resetting data) are available to the Operator only.</li>
</ul>
<h2>3. Shared data</h2>
<ul>
  <li>All data is fictional sample data <strong>shared between all users</strong>; your actions are visible to others.</li>
  <li>The Operator may reset the data at any time without notice.</li>
  <li>Do not enter personal, confidential or otherwise sensitive information.</li>
</ul>
<h2>4. Prohibited conduct</h2>
<ul>
  <li>Placing excessive load on the Service or other users, including automated bulk access</li>
  <li>Circumventing or attacking the authentication or authorization mechanisms</li>
  <li>Unlawful conduct or infringement of third-party rights</li>
</ul>
<h2>5. Disclaimer and limitation of liability</h2>
<p>The Service is provided "as is" without warranty of any kind. The Operator is not liable for any damages arising from use of or inability to use the Service. The Service depends on Cloudflare and Google and may become unavailable due to their outages or changes.</p>
<h2>6. Changes and termination</h2>
<p>The Operator may change, suspend or terminate the Service at any time without notice.</p>
<h2>7. Privacy</h2>
<p>Our handling of your information is described in the <a href="/privacy">Privacy Policy</a>.</p>
<h2>8. Changes to these terms and governing law</h2>
<p>These terms may change without notice; the version published on this page applies. They are governed by the laws of Japan.</p>
<h2>9. Contact</h2>
<p>${contact(ctx)}</p>
${nav(ctx)}`,
  );
}
