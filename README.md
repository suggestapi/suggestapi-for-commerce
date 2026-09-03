# SuggestAPI for Commerce

Build an AI shopping agent on top of the search you already run.

SuggestAPI is the retrieval layer. This repo is a working **storefront shopper**:
search → refine → add to cart → **checkout handoff**. The agent never places an
order or takes payment.

Guest mode needs no API keys. It shops a recorded catalog (Shopify
[mock.shop](https://mock.shop/) products in SuggestAPI suggestion shape) and
builds a real Shopify cart against `https://mock.shop/api`.

Skills that teach coding agents how to integrate SuggestAPI:
[suggestapi/skills](https://github.com/suggestapi/skills).

## Run

Node 20+.

```bash
npm install
cp .env.example .env
npm test
npm start
```

`npm test` is fixture replay: SuggestAPI-shaped catalog, mocked Shopify cart, no network, no LLM key. GitHub Actions runs the same command on every push.

Open http://localhost:3005

## Try

1. I need a hoodie under $100
2. Show only cotton
3. Add the second one

Then use **Checkout on Shopify**. That opens the store’s hosted checkout.
Nothing in this repository completes checkout.

## What talks to what

```text
Browser  →  local shopper API
                │
                ├─ SuggestAPI GET /v1/autocomplete   (or guest fixtures)
                └─ Shopify Storefront cartCreate     (checkoutUrl only)
```

- Empty `SUGGESTAPI_PUBLIC_KEY` → guest fixtures (`storefront/data/recorded-responses.json`).
- Set a public search key → live SuggestAPI. Put Shopify variant GIDs on
  `suggestion.extra.shopify_variant_id` if you want add-to-cart; otherwise the
  agent hands off to the product URL.
- Empty `OPENAI_API_KEY` → deterministic tool loop (same tools as the model).
- Set `OPENAI_API_KEY` → the model may call those tools. It never receives
  API keys; only product and cart JSON.

Re-record the guest catalog:

```bash
npm run record
```

## Layout

- `tests/` — shopper + HTTP fixture tests (`npm test`)
- `storefront/api/` — SuggestAPI client, Shopify cart adapter, shopper, HTTP host
- `storefront/web/` — product grid, chat, cart, checkout button
- `storefront/data/` — recorded guest catalog

Apache-2.0. See [NOTICE](NOTICE).
