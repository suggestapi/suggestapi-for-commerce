import { addVariantToCart, removeLineFromCart, type ShopifyEnv } from "./shopify-cart.ts";
import { searchProducts, type SearchEnv } from "./suggestapi.ts";
import type { Cart, Product, ShopperTurn, ToolCall } from "./types.ts";

export type Session = {
  products: Product[];
  lastQuery: string;
  cart: Cart | null;
};

export function emptySession(): Session {
  return { products: [], lastQuery: "", cart: null };
}

const ORDINALS: Record<string, number> = {
  first: 0,
  "1st": 0,
  second: 1,
  "2nd": 1,
  third: 2,
  "3rd": 2,
  fourth: 3,
  "4th": 3,
  fifth: 4,
  "5th": 4,
};

export type ShopperEnv = {
  search: SearchEnv;
  shopify: ShopifyEnv;
  openaiKey: string;
  openaiModel: string;
};

function pickOrdinal(message: string): number | undefined {
  const named = message.match(
    /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/i,
  );
  if (named) return ORDINALS[named[1].toLowerCase()];
  const nth = message.match(/\b(?:number|#|no\.?)\s*(\d+)\b/i);
  if (nth) return Number(nth[1]) - 1;
  if (/\badd (it|that|this|the one)\b/i.test(message)) return 0;
  return undefined;
}

function isRefine(message: string): boolean {
  return /^(show only|only |filter |narrow |just )\b/i.test(message.trim());
}

function isAdd(message: string): boolean {
  return /\badd\b/i.test(message) && pickOrdinal(message) != null;
}

export async function runSearch(
  session: Session,
  query: string,
  env: { search: SearchEnv },
): Promise<{ search: Awaited<ReturnType<typeof searchProducts>>; reply: string }> {
  const search = await searchProducts(query, env.search);
  session.lastQuery = query;
  session.products = search.suggestions;
  const n = search.suggestions.length;
  const reply =
    n === 0
      ? `No live catalog matches for “${query}”.`
      : `Found ${n} product${n === 1 ? "" : "s"} for “${search.query}”. SuggestAPI ${search.source === "fixtures" ? "guest fixtures" : "ranked search"} — refine or add one to the cart.`;
  return { search, reply };
}

export async function runAdd(
  session: Session,
  index: number,
  env: { shopify: ShopifyEnv },
): Promise<{ reply: string }> {
  const product = session.products[index];
  if (!product) {
    return { reply: "There isn’t a product in that position." };
  }
  const variant = product.extra.shopify_variant_id;
  if (!variant) {
    return {
      reply: `${product.title} has no Shopify variant id. Open ${product.url || "the product URL"} to buy on the store — this agent does not place orders.`,
    };
  }
  session.cart = await addVariantToCart(variant, session.cart?.id, env.shopify);
  return {
    reply: `Added ${product.title}. Checkout stays on Shopify — use the checkout button. This agent never takes payment.`,
  };
}

export async function runRemove(
  session: Session,
  lineId: string,
  env: { shopify: ShopifyEnv },
): Promise<{ reply: string }> {
  if (!session.cart?.id) return { reply: "Cart is empty." };
  const next = await removeLineFromCart(lineId, session.cart.id, env.shopify);
  session.cart = next.lines.length ? next : null;
  return { reply: session.cart ? "Removed from cart." : "Cart is empty." };
}

export async function heuristicTurn(
  session: Session,
  message: string,
  env: { search: SearchEnv; shopify: ShopifyEnv },
): Promise<ShopperTurn> {
  const tools: ToolCall[] = [];
  let search = null as ShopperTurn["search"];
  let reply: string;

  if (isAdd(message) && session.products.length) {
    const index = pickOrdinal(message) ?? 0;
    tools.push({ name: "add_to_cart", args: { index } });
    reply = (await runAdd(session, index, env)).reply;
  } else if (isRefine(message) && session.lastQuery) {
    const extra = message.replace(/^(show only|only|filter|narrow|just)\s+/i, "");
    const query = `${session.lastQuery} ${extra}`.trim();
    tools.push({ name: "refine_search", args: { query } });
    const out = await runSearch(session, query, env);
    search = out.search;
    reply = out.reply;
  } else {
    tools.push({ name: "search_products", args: { query: message } });
    const out = await runSearch(session, message, env);
    search = out.search;
    reply = out.reply;
  }

  return {
    reply,
    products: session.products,
    search,
    cart: session.cart,
    tools,
  };
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search the merchant catalog through SuggestAPI",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refine_search",
      description: "Run a follow-up catalog search (add filters or terms)",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Add a result to the Shopify cart by 0-based index. Does not check out.",
      parameters: {
        type: "object",
        properties: { index: { type: "integer" } },
        required: ["index"],
      },
    },
  },
];

export async function llmTurn(
  session: Session,
  message: string,
  env: ShopperEnv,
): Promise<ShopperTurn> {
  const tools: ToolCall[] = [];
  let search = null as ShopperTurn["search"];
  const messages: Record<string, unknown>[] = [
    {
      role: "system",
      content:
        "You are a storefront shopper. Use tools to search SuggestAPI and add to a Shopify cart. Never claim you placed an order or charged a card. Checkout is a handoff URL. You are not given API keys.",
    },
    { role: "user", content: message },
  ];

  for (let i = 0; i < 6; i++) {
    const res = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openaiModel,
        messages,
        tools: TOOLS,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const body = (await res.json()) as {
      choices: Array<{
        message: {
          role: string;
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const msg = body.choices[0]?.message;
    if (!msg) break;
    if (!msg.tool_calls?.length) {
      return {
        reply: msg.content || "Done.",
        products: session.products,
        search,
        cart: session.cart,
        tools,
      };
    }
    messages.push(msg);
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      const name = call.function.name;
      let result: unknown;
      if (name === "search_products" || name === "refine_search") {
        const query = String(args.query ?? "");
        tools.push({ name, args: { query } });
        const out = await runSearch(session, query, env);
        search = out.search;
        result = {
          reply: out.reply,
          products: session.products.map((p, index) => ({
            index,
            id: p.id,
            title: p.title,
            price: p.price,
            currency: p.currency,
            why: p.extra.why,
          })),
        };
      } else if (name === "add_to_cart") {
        const index = Number(args.index);
        tools.push({ name: "add_to_cart", args: { index } });
        result = await runAdd(session, index, env);
      } else {
        result = { error: "unknown tool" };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  return {
    reply: "Stopped after too many tool calls.",
    products: session.products,
    search,
    cart: session.cart,
    tools,
  };
}

export async function shopperTurn(
  session: Session,
  message: string,
  env: ShopperEnv,
): Promise<ShopperTurn> {
  if (env.openaiKey) return llmTurn(session, message, env);
  return heuristicTurn(session, message, env);
}
