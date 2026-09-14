/**
 * ontology-mcp — Worker エントリポイント。
 *
 *   /mcp                 MCP (Streamable HTTP)。OAuth 2.1 の Bearer トークン必須
 *   /authorize /token /register /.well-known/*   OAuthProvider が提供 (Dynamic Client Registration 対応)
 *   /callback            Google からの戻り (MCP クライアント向けログイン)
 *   /admin/*             所有者専用の管理画面 (独自の Google ログイン)
 *   /                    使い方
 */
import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";

import { adminRoutes } from "./admin/routes";
import { esc } from "./admin/views";
import { GoogleHandler } from "./auth/google-handler";
import { mcpApiHandler } from "./mcp/handler";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/", (c) => {
  const mcpUrl = new URL("/mcp", c.req.url).href;
  return c.html(
    `<!doctype html><meta charset="utf-8"><title>ontology-mcp</title>` +
      `<body style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">` +
      `<h1>ontology-mcp</h1><p>YAML で宣言したオントロジーを MCP ツールとして公開するデモです。Google アカウントでログインすると使えます。</p>` +
      `<p>Claude Code:</p><pre>claude mcp add --transport http ontology ${esc(mcpUrl)}</pre>` +
      `<p><a href="/admin">管理画面 (所有者のみ)</a></p></body>`,
  );
});
app.route("/admin", adminRoutes);
app.route("/", GoogleHandler);

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  // biome-ignore lint/suspicious/noExplicitAny: OAuthProvider の型は fetch(request, env, ctx) を要求する。Hono の fetch は互換
  defaultHandler: app as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
