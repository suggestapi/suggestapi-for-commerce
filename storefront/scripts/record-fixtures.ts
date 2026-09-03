import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "../api/types.ts";

const QUERY = `{ products(first: 50) { nodes {
  id title handle description
  featuredImage { url }
  variants(first: 1) { nodes { id title price { amount currencyCode } } }
} } }`;

const res = await fetch("https://mock.shop/api", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY }),
});
if (!res.ok) throw new Error(`mock.shop ${res.status}`);
const body = (await res.json()) as {
  data: {
    products: {
      nodes: Array<{
        id: string;
        title: string;
        handle: string;
        description: string;
        featuredImage?: { url: string } | null;
        variants: {
          nodes: Array<{
            id: string;
            title: string;
            price: { amount: string; currencyCode: string };
          }>;
        };
      }>;
    };
  };
};

const catalog: Product[] = body.data.products.nodes.map((p) => {
  const v = p.variants.nodes[0];
  return {
    id: p.handle,
    title: p.title,
    desc: p.description,
    url: `https://mock.shop/products/${p.handle}`,
    image_url: p.featuredImage?.url,
    price: v ? Number(v.price.amount) : undefined,
    currency: v?.price.currencyCode,
    extra: {
      shopify_product_id: p.id,
      shopify_variant_id: v?.id,
      handle: p.handle,
    },
  };
});

const out = {
  recorded_at: new Date().toISOString(),
  source: "https://mock.shop/api",
  note: "Guest catalog in SuggestAPI suggestion shape. Live SUGGESTAPI_PUBLIC_KEY bypasses this file.",
  catalog,
};
const dest = join(dirname(fileURLToPath(import.meta.url)), "../data/recorded-responses.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${catalog.length} products → ${dest}`);
