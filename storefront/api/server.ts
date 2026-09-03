import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptySession, shopperTurn, type Session } from "./agent.ts";
import { searchEnv } from "./suggestapi.ts";
import { shopifyEnv } from "./shopify-cart.ts";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "../web");
const sessions = new Map<string, Session>();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function shopperEnv() {
  return {
    search: searchEnv(),
    shopify: shopifyEnv(),
    openaiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
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
        const session = sessions.get(sessionId) ?? emptySession();
        sessions.set(sessionId, session);
        const turn = await shopperTurn(session, String(body.message ?? ""), shopperEnv());
        return json(res, 200, { sessionId, ...turn });
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        const sessionId = url.searchParams.get("sessionId") || "guest";
        const session = sessions.get(sessionId) ?? emptySession();
        return json(res, 200, {
          sessionId,
          products: session.products,
          cart: session.cart,
        });
      }
      if (req.method === "GET") {
        const file =
          url.pathname === "/" ? "/index.html" : url.pathname.replace(/\.\./g, "");
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

const port = Number(process.env.PORT ?? 3000);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createApp().listen(port, () => {
    console.log(`SuggestAPI shopper → http://localhost:${port}`);
  });
}
