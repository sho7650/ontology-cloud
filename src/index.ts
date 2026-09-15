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
import { GoogleHandler } from "./auth/google-handler";
import { homePage } from "./home";
import { privacyPage, termsPage } from "./legal/pages";
import { mcpApiHandler } from "./mcp/handler";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

const legalContext = (c: { req: { url: string }; env: Env }) => ({
  appName: c.env.APP_NAME,
  serviceUrl: new URL("/", c.req.url).href,
  ownerEmail: c.env.OWNER_EMAIL,
});

app.get("/", (c) =>
  c.html(
    homePage({
      appName: c.env.APP_NAME,
      mcpUrl: new URL("/mcp", c.req.url).href,
      ownerEmail: c.env.OWNER_EMAIL,
      siteVerification: c.env.GOOGLE_SITE_VERIFICATION,
    }),
  ),
);
app.get("/privacy", (c) => c.html(privacyPage(legalContext(c))));
app.get("/terms", (c) => c.html(termsPage(legalContext(c))));
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
