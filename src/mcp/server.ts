/**
 * MCP サーバー本体。型に依存しない汎用 5 ツール + 所有者専用の reset_sample_data。
 * リクエストごとに createServer() で生成する (createMcpHandler はステートレス)。
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ONTOLOGY } from "../ontology/current";
import { type Json, type Ontology, linkType, objectType } from "../ontology/schema";
import { validateProps } from "../ontology/validate";
import { executeAction } from "../store/actions";
import { writeAudit } from "../store/audit";
import { flatten, getObject, searchObjects, traverse } from "../store/objects";
import { resetSampleData } from "../store/seed";

export const SERVER_INFO = { name: "ontology-mcp", version: "0.2.0" } as const;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
export const RESET_ACTION = "reset_sample_data";

export type UserProps = { email: string; name?: string };

export const isUserProps = (p: unknown): p is UserProps =>
  typeof p === "object" && p !== null && typeof (p as UserProps).email === "string" && (p as UserProps).email.length > 0;

const JsonValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

const fail = (e: unknown): ToolResult => ({ isError: true, content: [{ type: "text", text: (e as Error).message }] });

/** 検証エラーや not found はメッセージそのままを isError で返す (Claude が理由を読める)。 */
const guarded =
  <A>(fn: (args: A) => Promise<ToolResult>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(e);
    }
  };

export function createServer(env: Env, user: UserProps, ontology: Ontology = ONTOLOGY): McpServer {
  const server = new McpServer(SERVER_INFO);
  const db = env.DB;

  server.registerTool(
    "describe_ontology",
    {
      description: "オントロジー全体 (ObjectType / LinkType / ActionType) を返す。最初に必ず呼ぶこと。",
      inputSchema: z.object({}),
    },
    guarded(async () => ok(ontology as unknown as Record<string, unknown>)),
  );

  server.registerTool(
    "search_objects",
    {
      description: "ObjectType のインスタンスを検索する。filter は {property: value} の完全一致 (AND)。",
      inputSchema: z.object({
        type: z.string().describe("ObjectType 名"),
        filter: z.record(z.string(), JsonValue).optional().describe("プロパティの完全一致条件"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe(`最大件数 (1〜${MAX_LIMIT})`),
      }),
    },
    guarded(async ({ type, filter, limit }) => {
      const f = (filter ?? {}) as Record<string, Json>;
      validateProps(ontology, type, f, { partial: true });
      const objects = (await searchObjects(db, type, f, limit)).map(flatten);
      return ok({ objects });
    }),
  );

  server.registerTool(
    "get_object",
    {
      description: "ObjectType と主キーで 1 件取得する。",
      inputSchema: z.object({ type: z.string(), id: z.string() }),
    },
    guarded(async ({ type, id }) => {
      objectType(ontology, type);
      const found = await getObject(db, type, id);
      if (!found) throw new Error(`${type}#${id} not found`);
      return ok(flatten(found));
    }),
  );

  server.registerTool(
    "traverse",
    {
      description: "オブジェクトからリンクをたどる。type が link の from 側なら順方向、to 側なら逆方向。",
      inputSchema: z.object({ type: z.string(), id: z.string(), link: z.string() }),
    },
    guarded(async ({ type, id, link }) => {
      const objects = (await traverse(db, link, linkType(ontology, link), type, id)).map(flatten);
      return ok({ objects });
    }),
  );

  server.registerTool(
    "execute_action",
    {
      description:
        "ActionType を実行する。precondition 不成立は ok=false と理由を返す。パラメータ不正・対象なしはエラー。" +
        "結果は audit_log に記録される。",
      inputSchema: z.object({
        action: z.string(),
        target_id: z.string(),
        params: z.record(z.string(), JsonValue).optional(),
      }),
    },
    guarded(async ({ action, target_id, params }) => ok(await executeAction(db, ontology, user.email, action, target_id, params ?? {}))),
  );

  if (user.email === env.OWNER_EMAIL) {
    server.registerTool(
      RESET_ACTION,
      { description: "サンプルデータを初期状態に戻す (所有者のみ)。全オブジェクト・リンク・監査ログを消して入れ直す。", inputSchema: z.object({}) },
      guarded(async () => {
        if (user.email !== env.OWNER_EMAIL) throw new Error("forbidden");
        await resetSampleData(db);
        await writeAudit(db, { actor: user.email, action: RESET_ACTION, targetType: "*", targetId: "*", params: {}, before: null, after: null, result: "ok" });
        return ok({ ok: true });
      }),
    );
  }

  return server;
}
