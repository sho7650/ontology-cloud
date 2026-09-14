/**
 * 管理画面用の署名付き Cookie (HMAC-SHA256, WebCrypto)。
 * - admin_session: ログイン済み所有者の email と有効期限
 * - admin_oauth_state: Google ログインの state (CSRF 対策)
 * どちらも Path=/admin に限定し、MCP 側の OAuth Cookie とは独立。
 */

export const SESSION_COOKIE = "admin_session";
export const STATE_COOKIE = "admin_oauth_state";
export const SESSION_TTL_SEC = 60 * 60 * 24;
const STATE_TTL_SEC = 60 * 10;

type SessionPayload = { email: string; exp: number };

const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** payload を base64url + 署名の形にする。 */
export async function sign(secret: string, payload: string): Promise<string> {
  const body = b64url(enc.encode(payload));
  return `${body}.${await hmac(secret, body)}`;
}

/** 署名を検証して payload を返す。壊れていれば null。 */
export async function verify(secret: string, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;
  if (!timingSafeEqual(await hmac(secret, body), sig)) return null;
  try {
    return fromB64url(body);
  } catch {
    return null;
  }
}

/** 長さも含めて定数時間で比較する (秘密由来の値どうしの比較に使う)。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const lengthDiff = a.length ^ b.length;
  return [...a].reduce((diff, ch, i) => diff | (ch.charCodeAt(0) ^ (b.charCodeAt(i) || 0)), lengthDiff) === 0;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  return header
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c.startsWith(`${name}=`))
    .map((c) => c.slice(name.length + 1))[0];
}

const cookie = (name: string, value: string, maxAge: number): string =>
  `${name}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const now = (): number => Math.floor(Date.now() / 1000);

// ---- session ----
export async function createSessionCookie(secret: string, email: string, ttlSec = SESSION_TTL_SEC): Promise<string> {
  const payload: SessionPayload = { email, exp: now() + ttlSec };
  return cookie(SESSION_COOKIE, await sign(secret, JSON.stringify(payload)), ttlSec);
}

export const clearSessionCookie = (): string => cookie(SESSION_COOKIE, "", 0);

/** 有効なセッションなら email を返す。 */
export async function readSession(request: Request, secret: string): Promise<string | null> {
  const payload = await verify(secret, readCookie(request, SESSION_COOKIE));
  if (!payload) return null;
  try {
    const { email, exp } = JSON.parse(payload) as SessionPayload;
    return typeof email === "string" && typeof exp === "number" && exp > now() ? email : null;
  } catch {
    return null;
  }
}

// ---- OAuth state ----
type StatePayload = { state: string; exp: number };

/** state はランダム値 + 有効期限を署名して Cookie に入れる (Max-Age だけに頼らない)。 */
export async function createStateCookie(secret: string, ttlSec = STATE_TTL_SEC): Promise<{ state: string; setCookie: string }> {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const payload: StatePayload = { state, exp: now() + ttlSec };
  return { state, setCookie: cookie(STATE_COOKIE, await sign(secret, JSON.stringify(payload)), Math.max(ttlSec, 0)) };
}

export const clearStateCookie = (): string => cookie(STATE_COOKIE, "", 0);

export async function verifyState(request: Request, secret: string, state: string | undefined): Promise<boolean> {
  const payload = await verify(secret, readCookie(request, STATE_COOKIE));
  if (payload === null || state === undefined) return false;
  try {
    const { state: expected, exp } = JSON.parse(payload) as StatePayload;
    return typeof expected === "string" && typeof exp === "number" && exp > now() && timingSafeEqual(expected, state);
  } catch {
    return false;
  }
}

// ---- CSRF (フォーム二重送信) ----
/** セッション Cookie の署名部分から派生させる。Cookie を持つブラウザだけが正しい値を出せる。 */
export async function csrfToken(secret: string, request: Request): Promise<string | null> {
  const session = readCookie(request, SESSION_COOKIE);
  return session ? hmac(secret, `csrf:${session}`) : null;
}
