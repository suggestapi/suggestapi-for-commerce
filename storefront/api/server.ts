import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptySession, runAdd, runRemove, shopperTurn, type Session } from "./agent.ts";
import { searchEnv } from "./suggestapi.ts";
import { shopifyEnv } from "./shopify-cart.ts";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "../web");
const sessions = new Map<string, Session>();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function shopperEnv() {
  return {
    search: searchEnv(),
    shopify: shopifyEnv(),
    openaiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
}

function getSession(sessionId: string): Session {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const session = emptySession();
  sessions.set(sessionId, session);
  return session;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          sessionId?: string;
          message?: string;
        };
        const sessionId = body.sessionId || "guest";
        const session = getSession(sessionId);
        const turn = await shopperTurn(session, String(body.message ?? ""), shopperEnv());
        return json(res, 200, { sessionId, ...turn });
      }
      if (req.method === "POST" && url.pathname === "/api/cart") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          sessionId?: string;
          index?: number;
        };
        const sessionId = body.sessionId || "guest";
        const session = getSession(sessionId);
        const index = Number(body.index);
        const tools = [{ name: "add_to_cart" as const, args: { index } }];
        const { reply } = await runAdd(session, index, shopperEnv());
        return json(res, 200, {
          sessionId,
          reply,
          products: session.products,
          search: null,
          cart: session.cart,
          tools,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/cart/remove") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          sessionId?: string;
          lineId?: string;
        };
        const sessionId = body.sessionId || "guest";
        const session = getSession(sessionId);
        const { reply } = await runRemove(session, String(body.lineId ?? ""), shopperEnv());
        return json(res, 200, {
          sessionId,
          reply,
          products: session.products,
          search: null,
          cart: session.cart,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        const sessionId = url.searchParams.get("sessionId") || "guest";
        const session = getSession(sessionId);
        return json(res, 200, {
          sessionId,
          products: session.products,
          search: null,
          cart: session.cart,
        });
      }
      if (req.method === "GET") {
        const file =
          url.pathname === "/" ? "index.html" : url.pathname.replace(/\.\./g, "").replace(/^\/+/, "");
        const path = join(webDir, file);
        const body = readFileSync(path);
        res.writeHead(200, {
          "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
        });
        return res.end(body);
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

const port = Number(process.env.PORT ?? 3005);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createApp();
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop that process or set PORT.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, () => {
    console.log(`SuggestAPI shopper → http://localhost:${port}`);
  });
}
