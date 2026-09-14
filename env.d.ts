declare module "*.yaml" {
  const text: string;
  export default text;
}

// wrangler types が生成する Env には vars しか出ないので、secret とテスト用 binding を補う。
// (生成物の形に依存しないよう Cloudflare.Env とグローバル Env の両方を拡張する)
interface ExtraEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  HOSTED_DOMAIN?: string;
  /** テストのみ: vitest.config.ts が miniflare binding として渡すマイグレーション一覧 */
  TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
}
interface Env extends ExtraEnv {}
declare namespace Cloudflare {
  interface Env extends ExtraEnv {}
}
