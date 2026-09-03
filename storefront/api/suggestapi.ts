import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike, Product, SearchHit } from "./types.ts";

const fixturesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/recorded-responses.json",
);

export type CatalogFixture = {
  recorded_at: string;
  source: string;
  catalog: Product[];
};

export type SearchEnv = {
  baseUrl: string;
  apiKey: string;
  index: string;
  fetch: FetchLike;
  catalog: Product[];
};

export function loadCatalog(): Product[] {
  const data = JSON.parse(readFileSync(fixturesPath, "utf8")) as CatalogFixture;
  return data.catalog;
}

export function searchEnv(overrides: Partial<SearchEnv> = {}): SearchEnv {
  return {
    baseUrl: process.env.SUGGESTAPI_BASE_URL ?? "https://api.suggestapi.com",
    apiKey: process.env.SUGGESTAPI_PUBLIC_KEY ?? "",
    index: process.env.SUGGESTAPI_INDEX ?? "ecommerce",
    fetch: globalThis.fetch,
    catalog: loadCatalog(),
    ...overrides,
  };
}

export function productFromSuggestion(raw: Record<string, unknown>): Product {
  const extraIn =
    raw.extra && typeof raw.extra === "object"
      ? (raw.extra as Record<string, unknown>)
      : {};
  const priceRaw = raw.price ?? extraIn.price;
  const price =
    typeof priceRaw === "number"
      ? priceRaw
      : typeof priceRaw === "string"
        ? Number(priceRaw)
        : undefined;
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    subtitle: raw.subtitle ? String(raw.subtitle) : undefined,
    desc: raw.desc ? String(raw.desc) : undefined,
    url: String(raw.url ?? ""),
    image_url: raw.image_url ? String(raw.image_url) : undefined,
    price: Number.isFinite(price) ? price : undefined,
    currency: raw.currency ? String(raw.currency) : undefined,
    score: typeof raw.score === "number" ? raw.score : undefined,
    extra: {
      shopify_variant_id: extraIn.shopify_variant_id
        ? String(extraIn.shopify_variant_id)
        : undefined,
      shopify_product_id: extraIn.shopify_product_id
        ? String(extraIn.shopify_product_id)
        : undefined,
      handle: extraIn.handle ? String(extraIn.handle) : undefined,
      why: extraIn.why ? String(extraIn.why) : undefined,
    },
  };
}

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["the", "for", "and", "with", "need", "looking", "show", "only", "under", "over", "than", "from"].includes(t));
}

function parseMaxPrice(q: string): number | undefined {
  const m = q.match(/under\s*\$?\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : undefined;
}

export function searchFixtures(
  catalog: Product[],
  originalQuery: string,
): SearchHit {
  const maxPrice = parseMaxPrice(originalQuery);
  const qTokens = tokens(originalQuery);
  const scored = catalog
    .map((p) => {
      const hay = `${p.title} ${p.desc ?? ""} ${p.subtitle ?? ""}`.toLowerCase();
      const hits = qTokens.filter((t) => t[0] !== "$" && !/^\d+$/.test(t) && hay.includes(t));
      const score = hits.length;
      const why =
        hits.length > 0
          ? `Matched “${hits.slice(0, 3).join("”, “")}” in the catalog text`
          : "In the guest catalog";
      return { p, score, why };
    })
    .filter(({ p, score }) => {
      if (maxPrice != null && (p.price == null || p.price > maxPrice)) return false;
      if (qTokens.length === 0) return true;
      return score === qTokens.filter((t) => t[0] !== "$" && !/^\d+$/.test(t)).length;
    })
    .sort((a, b) => b.score - a.score || (a.p.price ?? 0) - (b.p.price ?? 0));

  return {
    query: originalQuery,
    original_query: originalQuery,
    source: "fixtures",
    suggestions: scored.slice(0, 8).map(({ p, score, why }) => ({
      ...p,
      score,
      extra: { ...p.extra, why },
    })),
  };
}

export async function searchProducts(
  originalQuery: string,
  env: SearchEnv = searchEnv(),
): Promise<SearchHit> {
  const query = originalQuery.trim();
  if (!query) {
    return {
      query,
      original_query: originalQuery,
      source: env.apiKey ? "suggestapi" : "fixtures",
      suggestions: [],
    };
  }
  if (!env.apiKey) return searchFixtures(env.catalog, query);

  const url = new URL("/v1/autocomplete", env.baseUrl);
  url.searchParams.set("index", env.index);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("mode", "hybrid");

  const res = await env.fetch(url, { headers: { "x-api-key": env.apiKey } });
  if (!res.ok) {
    const fallback = searchFixtures(env.catalog, query);
    return { ...fallback, degraded: true };
  }
  const body = (await res.json()) as {
    query?: string;
    original_query?: string;
    suggestions?: Record<string, unknown>[];
    degraded?: boolean;
  };
  return {
    query: body.query ?? query,
    original_query: body.original_query ?? originalQuery,
    degraded: body.degraded,
    source: "suggestapi",
    suggestions: (body.suggestions ?? []).map(productFromSuggestion),
  };
}
