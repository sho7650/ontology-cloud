/**
 * 管理画面の HTML。依存を増やさずテンプレート文字列で組む。値は必ず esc() を通す。
 */
import type { AuditRow } from "../store/audit";
import type { LinkRow, StoredObject } from "../store/objects";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

const STYLE = `
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 1.5rem; color: #1f2933; background: #f8fafc; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; background: #fff; }
  th, td { border: 1px solid #d9e2ec; padding: 0.3rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #e4ebf3; } code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
  .bar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  button { padding: 0.4rem 0.9rem; border-radius: 4px; border: 1px solid #9aa5b1; background: #fff; cursor: pointer; }
  button.danger { border-color: #c81e1e; color: #c81e1e; }
  .muted { color: #616e7c; font-size: 0.85rem; }
`;

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

export const loginPage = (): string =>
  page(
    "ontology-mcp admin",
    `<h1>ontology-mcp 管理画面</h1><p class="muted">所有者の Google アカウントでログインするとデータの一覧とリセットができます。</p>` +
      `<p><a href="/admin/login"><button>Google でログイン</button></a></p>`,
  );

export const forbiddenPage = (email: string): string =>
  page("forbidden", `<h1>403</h1><p>${esc(email)} はこのデモの所有者ではありません。</p><p><a href="/admin">戻る</a></p>`);

type Dashboard = {
  email: string;
  csrf: string;
  objects: StoredObject[];
  links: LinkRow[];
  audit: AuditRow[];
  resetDone?: boolean;
};

export function dashboardPage(d: Dashboard): string {
  const byType = Object.entries(
    d.objects.reduce<Record<string, StoredObject[]>>((acc, o) => ({ ...acc, [o.type]: [...(acc[o.type] ?? []), o] }), {}),
  );
  const objectTables = byType
    .map(
      ([type, rows]) =>
        `<h2>${esc(type)} <span class="muted">(${rows.length})</span></h2><table><tr><th>id</th><th>props</th></tr>` +
        rows.map((o) => `<tr><td>${esc(o.id)}</td><td><code>${esc(JSON.stringify(o.props))}</code></td></tr>`).join("") +
        "</table>",
    )
    .join("");
  const linkTable =
    `<h2>links <span class="muted">(${d.links.length})</span></h2><table><tr><th>type</th><th>from</th><th>to</th></tr>` +
    d.links.map((l) => `<tr><td>${esc(l.type)}</td><td>${esc(l.from_id)}</td><td>${esc(l.to_id)}</td></tr>`).join("") +
    "</table>";
  const auditTable =
    `<h2>audit_log <span class="muted">(直近 ${d.audit.length} 件)</span></h2><table>` +
    "<tr><th>seq</th><th>at</th><th>actor</th><th>action</th><th>target</th><th>result</th><th>detail</th></tr>" +
    d.audit
      .map(
        (a) =>
          `<tr><td>${a.seq}</td><td>${esc(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td>` +
          `<td>${esc(a.target_type)}#${esc(a.target_id)}</td><td>${esc(a.result)}</td>` +
          `<td><code>${esc(a.error ?? a.after ?? a.params ?? "")}</code></td></tr>`,
      )
      .join("") +
    "</table>";
  const notice = d.resetDone ? `<p class="muted">サンプルデータをリセットしました。</p>` : "";
  return page(
    "ontology-mcp admin",
    `<h1>ontology-mcp 管理画面</h1><div class="bar"><span>${esc(d.email)}</span>` +
      `<form method="post" action="/admin/reset" onsubmit="return confirm('サンプルデータを初期状態に戻します。よろしいですか？')">` +
      `<input type="hidden" name="csrf" value="${esc(d.csrf)}"><button class="danger">サンプルデータをリセット</button></form>` +
      `<form method="post" action="/admin/logout"><button>ログアウト</button></form></div>${notice}${objectTables}${linkTable}${auditTable}`,
  );
}
