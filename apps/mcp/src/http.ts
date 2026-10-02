import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPointUpClient, PointUpApiError } from "@pointup/api-client";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";

const MAX_BODY = 32_768;
const DEADLINE_MS = 20_000;

export function loadHttpConfig(env: NodeJS.ProcessEnv) {
  // Validate the API origin with the same rules as stdio, without a process credential.
  if (env.POINTUP_AGENT_TOKEN || env.POINTUP_SESSION_TOKEN) throw new Error("HTTP mode accepts credentials only in each Authorization header.");
  const base = loadConfig({ ...env, POINTUP_AGENT_TOKEN: "pu_config-validation" });
  const port = Number(env.POINTUP_MCP_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MCP port.");
  const publicOrigin = env.POINTUP_MCP_PUBLIC_ORIGIN;
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Public MCP origin must be a trusted HTTPS origin.");
    if (env.POINTUP_MCP_TRUST_HTTPS_PROXY !== "true") throw new Error("Public MCP origin requires explicit trusted HTTPS proxy configuration.");
  } else if (env.POINTUP_MCP_TRUST_HTTPS_PROXY) throw new Error("Trusted proxy configuration requires a public HTTPS origin.");
  return { baseUrl: base.baseUrl, allowWrites: base.allowWrites, port, publicOrigin: publicOrigin ? new URL(publicOrigin).origin : undefined };
}

type HttpOptions = ReturnType<typeof loadHttpConfig> & {
  /** Test injection; credentials are still constructed independently per request. */
  fetch?: typeof fetch;
};

function reject(res: ServerResponse, status: number, message: string) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...(status === 405 ? { Allow: "POST" } : {}) });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let exceeded = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!exceeded) { exceeded = true; chunks.length = 0; reject(new Error("BODY_LIMIT")); }
      } else if (!exceeded) chunks.push(chunk);
    });
    req.once("end", () => {
      if (exceeded) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); }
    });
    req.once("error", reject);
    req.once("aborted", () => reject(new Error("Request aborted.")));
  });
}

/** Private bearer integration, always bound to loopback. No shared MCP sessions or tokens. */
export function createHttpMcpServer(options: HttpOptions) {
  let active = 0;
  let windowStart = Date.now();
  let requests = 0;
  const http = createHttpServer({ maxHeaderSize: 20_480 }, (req, res) => {
    void handle(req, res);
  });
  http.requestTimeout = DEADLINE_MS;
  http.headersTimeout = 10_000;
  http.keepAliveTimeout = 5_000;
  http.maxRequestsPerSocket = 100;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    // Host is checked exactly; forwarded headers never grant trust. Reject token URLs.
    const port = (http.address() as { port: number } | null)?.port ?? options.port;
    const origin = options.publicOrigin ?? `http://127.0.0.1:${port}`;
    if (req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin)) return reject(res, 403, "Untrusted host or origin.");
    if (req.url !== "/mcp") return reject(res, 404, "Endpoint not found.");
    if (req.method !== "POST") return reject(res, 405, "Method not allowed.");
    if (req.headers["mcp-session-id"] !== undefined) return reject(res, 400, "This endpoint is stateless.");
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) return reject(res, 415, "Use application/json.");
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer pu_[A-Za-z0-9_-]{1,16380}$/.test(auth)) return reject(res, 401, "Supply a personal agent token in Authorization.");
    const length = req.headers["content-length"];
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return reject(res, 413, "Request body too large.");
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 120 || active >= 16) { res.setHeader("Retry-After", "60"); return reject(res, 429, "Request limit reached."); }
    active++;
    const abort = new AbortController();
    let mcp: ReturnType<typeof createServer> | undefined;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      active--;
      abort.abort();
      void mcp?.close().catch(() => {});
    };
    const timer = setTimeout(() => { reject(res, 504, "Request timed out."); cleanup(); req.destroy(); }, DEADLINE_MS);
    res.once("close", cleanup);
    try {
      const body = await readBody(req);
      if (finished) return;
      const client = createPointUpClient({
        baseUrl: options.baseUrl, headers: { Authorization: auth }, timeoutMs: 15_000,
        fetch: (input, init) => (options.fetch ?? fetch)(input, { ...init, redirect: "error", signal: AbortSignal.any([abort.signal, ...(init?.signal ? [init.signal] : [])]) }),
      });
      // Authenticate discovery/initialize as well as tools via an existing scoped read.
      // This private integration requires portfolio:read, including for proposal-only users.
      await client.getPortfolioSummary();
      if (finished) return;
      mcp = createServer(client, options.allowWrites);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      const status = error instanceof PointUpApiError ? (error.status === 401 || error.status === 403 ? error.status : 502) : error instanceof SyntaxError ? 400 : error instanceof Error && error.message === "BODY_LIMIT" ? 413 : 502;
      reject(res, status, status === 401 || status === 403 ? "Credential rejected by PointUp." : status === 400 ? "Invalid JSON body." : status === 413 ? "Request body too large." : "PointUp request failed.");
    }
  }
  return http;
}

export async function startHttpServer(env: NodeJS.ProcessEnv) {
  const options = loadHttpConfig(env);
  const http = createHttpMcpServer(options);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, "127.0.0.1", resolve);
  });
  return http;
}
