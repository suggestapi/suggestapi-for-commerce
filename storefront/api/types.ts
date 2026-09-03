export type Product = {
  id: string;
  title: string;
  subtitle?: string;
  desc?: string;
  url: string;
  image_url?: string;
  price?: number;
  currency?: string;
  score?: number;
  extra: {
    shopify_variant_id?: string;
    shopify_product_id?: string;
    handle?: string;
    why?: string;
  };
};

export type SearchHit = {
  query: string;
  original_query: string;
  suggestions: Product[];
  degraded?: boolean;
  source: "suggestapi" | "fixtures";
};

export type CartLine = {
  id: string;
  title: string;
  quantity: number;
  variant_id: string;
};

export type Cart = {
  id: string;
  checkout_url: string;
  currency: string;
  total: string;
  lines: CartLine[];
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ToolName = "search_products" | "refine_search" | "add_to_cart";

export type ToolCall = {
  name: ToolName;
  args: Record<string, unknown>;
};

export type ShopperTurn = {
  reply: string;
  products: Product[];
  search: SearchHit | null;
  cart: Cart | null;
  tools: ToolCall[];
};
