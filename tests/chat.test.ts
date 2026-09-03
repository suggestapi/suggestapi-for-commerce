import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../storefront/api/server.ts";

function listen(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createApp();
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) =>
            server.close((err) => (err ? fail(err) : done())),
          ),
      });
    });
    server.on("error", reject);
  });
}

test("POST /api/chat returns fixture products without an LLM key", async () => {
  const { url, close } = await listen();
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "test",
        message: "I need a hoodie under $100",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      products: { title: string }[];
      tools: { name: string }[];
      cart: unknown;
    };
    assert.equal(body.tools[0]?.name, "search_products");
    assert.ok(body.products.some((p) => /hoodie/i.test(p.title)));
    assert.equal(body.cart, null);
  } finally {
    await close();
  }
});
