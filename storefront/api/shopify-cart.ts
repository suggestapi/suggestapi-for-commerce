import type { Cart, FetchLike } from "./types.ts";

const CART_FIELDS = `
  id
  checkoutUrl
  cost { totalAmount { amount currencyCode } }
  lines(first: 20) {
    nodes {
      id
      quantity
      merchandise {
        ... on ProductVariant {
          id
          title
          product { title }
        }
      }
    }
  }
`;

const CREATE = `mutation cartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { ${CART_FIELDS} }
    userErrors { field message }
  }
}`;

const ADD = `mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) {
    cart { ${CART_FIELDS} }
    userErrors { field message }
  }
}`;

export type ShopifyEnv = {
  graphqlUrl: string;
  token: string;
  fetch: FetchLike;
};

export function shopifyEnv(overrides: Partial<ShopifyEnv> = {}): ShopifyEnv {
  return {
    graphqlUrl: process.env.SHOPIFY_GRAPHQL_URL ?? "https://mock.shop/api",
    token: process.env.SHOPIFY_STOREFRONT_TOKEN ?? "",
    fetch: globalThis.fetch,
    ...overrides,
  };
}

type GqlCart = {
  id: string;
  checkoutUrl: string;
  cost: { totalAmount: { amount: string; currencyCode: string } };
  lines: {
    nodes: Array<{
      id: string;
      quantity: number;
      merchandise: { id: string; title?: string; product?: { title: string } };
    }>;
  };
};

function asCart(c: GqlCart): Cart {
  return {
    id: c.id,
    checkout_url: c.checkoutUrl,
    currency: c.cost.totalAmount.currencyCode,
    total: c.cost.totalAmount.amount,
    lines: c.lines.nodes.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      variant_id: line.merchandise.id,
      title: line.merchandise.product?.title
        ? `${line.merchandise.product.title} (${line.merchandise.title ?? ""})`.trim()
        : line.merchandise.id,
    })),
  };
}

async function shopifyGraphql(
  env: ShopifyEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.token) headers["X-Shopify-Storefront-Access-Token"] = env.token;
  const res = await env.fetch(env.graphqlUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify Storefront ${res.status}`);
  const body = (await res.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

function userErrors(payload: { userErrors?: { message: string }[] }): void {
  const err = payload.userErrors?.[0];
  if (err) throw new Error(err.message);
}

export async function addVariantToCart(
  variantId: string,
  cartId: string | undefined,
  env: ShopifyEnv = shopifyEnv(),
): Promise<Cart> {
  // Checkout is a handoff via cart.checkoutUrl. This repo never completes payment.
  if (!cartId) {
    const data = (await shopifyGraphql(env, CREATE, {
      input: { lines: [{ quantity: 1, merchandiseId: variantId }] },
    })) as { cartCreate: { cart: GqlCart; userErrors?: { message: string }[] } };
    userErrors(data.cartCreate);
    return asCart(data.cartCreate.cart);
  }
  const data = (await shopifyGraphql(env, ADD, {
    cartId,
    lines: [{ quantity: 1, merchandiseId: variantId }],
  })) as { cartLinesAdd: { cart: GqlCart; userErrors?: { message: string }[] } };
  userErrors(data.cartLinesAdd);
  return asCart(data.cartLinesAdd.cart);
}
