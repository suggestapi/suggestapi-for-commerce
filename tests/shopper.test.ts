import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySession, heuristicTurn } from "../storefront/api/agent.ts";
import { shopifyEnv } from "../storefront/api/shopify-cart.ts";
import { searchEnv, searchProducts } from "../storefront/api/suggestapi.ts";

const catalog = searchEnv().catalog;

const gqlCart = {
  id: "gid://shopify/Cart/test?key=k",
  checkoutUrl: "https://demostore.mock.shop/checkout",
  cost: { totalAmount: { amount: "90.0", currencyCode: "CAD" } },
  lines: {
    nodes: [
      {
        id: "gid://shopify/CartLine/1",
        quantity: 1,
        merchandise: {
          id: "gid://shopify/ProductVariant/1",
          title: "Small",
          product: { title: "Hoodie" },
        },
      },
    ],
  },
};

function fakeShopify() {
  return async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    const payload = body.query?.includes("cartLinesAdd")
      ? { cartLinesAdd: { cart: gqlCart, userErrors: [] } }
      : { cartCreate: { cart: gqlCart, userErrors: [] } };
    return new Response(JSON.stringify({ data: payload }), {
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("guest search uses fixtures when no public key", async () => {
  const hit = await searchProducts("hoodie under 100", searchEnv({ apiKey: "" }));
  assert.equal(hit.source, "fixtures");
  assert.ok(hit.suggestions.some((p) => /hoodie/i.test(p.title)));
  assert.ok(hit.suggestions.every((p) => (p.price ?? 0) <= 100));
});

test("live SuggestAPI client sends only x-api-key and maps suggestions", async () => {
  const seen: RequestInit[] = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    seen.push(init ?? {});
    assert.equal(
      String(url),
      "https://api.suggestapi.com/v1/autocomplete?index=ecommerce&query=hoodie&limit=8&mode=hybrid",
    );
    return new Response(
      JSON.stringify({
        query: "hoodie",
        original_query: "hoodie",
        suggestions: [
          {
            id: "h1",
            title: "Soft Cotton Hoodie in Clay",
            price: 90,
            currency: "CAD",
            extra: { shopify_variant_id: "gid://shopify/ProductVariant/1" },
          },
        ],
      }),
    );
  };
  const hit = await searchProducts(
    "hoodie",
    searchEnv({ apiKey: "pub_test", fetch, catalog }),
  );
  assert.equal(hit.source, "suggestapi");
  assert.equal(hit.suggestions[0].extra.shopify_variant_id, "gid://shopify/ProductVariant/1");
  const headers = seen[0].headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "pub_test");
  assert.equal(JSON.stringify(hit.suggestions).includes("pub_test"), false);
});

test("shopper: search → refine → add; checkout is a URL; keys never in the turn", async () => {
  const env = {
    search: searchEnv({ apiKey: "" }),
    shopify: shopifyEnv({
      token: "shp_secret",
      fetch: fakeShopify(),
    }),
  };
  const session = emptySession();
  const search = await heuristicTurn(session, "I need a hoodie under $100", env);
  assert.equal(search.tools[0].name, "search_products");
  assert.ok(search.products.length >= 2);

  const refine = await heuristicTurn(session, "Show only cotton", env);
  assert.equal(refine.tools[0].name, "refine_search");
  assert.ok(refine.products.every((p) => /cotton|hoodie/i.test(`${p.title} ${p.desc}`)));

  const add = await heuristicTurn(session, "Add the second one", env);
  assert.equal(add.tools[0].name, "add_to_cart");
  assert.equal(add.cart?.checkout_url, "https://demostore.mock.shop/checkout");
  assert.ok(add.cart && !("complete_checkout" in add.cart));
  const blob = JSON.stringify(add);
  assert.equal(blob.includes("shp_secret"), false);
  assert.equal(blob.includes("OPENAI"), false);
});

test("add without a variant id hands off to the product URL", async () => {
  const session = emptySession();
  session.products = [
    {
      id: "x",
      title: "Mystery SKU",
      url: "https://example.com/products/x",
      extra: {},
    },
  ];
  const out = await heuristicTurn(session, "Add the first one", {
    search: searchEnv({ apiKey: "" }),
    shopify: shopifyEnv({ fetch: fakeShopify() }),
  });
  assert.match(out.reply, /no Shopify variant/i);
  assert.equal(session.cart, null);
});
