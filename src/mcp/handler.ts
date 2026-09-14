/**
 * OAuthProvider の apiHandler。認証済みリクエストだけがここに来る。
 * props (email など) は OAuthProvider がトークンから復号し、createMcpHandler が
 * AsyncLocalStorage に載せるので、ファクトリ内で getMcpAuthContext() から読める。
 */
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";

import { createServer, isUserProps } from "./server";

export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const handler = createMcpHandler(() => {
      const props = getMcpAuthContext()?.props;
      if (!isUserProps(props)) throw new Error("unauthenticated: missing user props");
      return createServer(env, props);
    });
    return handler(request, env, ctx);
  },
};
