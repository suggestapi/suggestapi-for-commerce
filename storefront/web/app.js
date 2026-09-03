const sessionId = crypto.randomUUID();
const log = document.getElementById("log");
const grid = document.getElementById("grid");
const cartEl = document.getElementById("cart");
const meta = document.getElementById("meta");
const cartCount = document.getElementById("cart-count");
const cartEmpty = document.getElementById("cart-empty");
const checkout = document.getElementById("checkout");
const form = document.getElementById("form");
const input = document.getElementById("input");

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function line(role, text) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  log.appendChild(li);
  li.scrollIntoView({ block: "nearest" });
}

function money(p) {
  if (p.price == null) return "";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: p.currency || "USD",
  }).format(p.price);
}

function render(turn) {
  grid.replaceChildren();
  for (const [i, p] of (turn.products || []).entries()) {
    const li = document.createElement("li");
    const img = p.image_url
      ? `<img alt="" src="${esc(p.image_url)}" />`
      : `<div class="ph"></div>`;
    li.innerHTML = `<div class="media">${img}<button type="button" class="add" data-add="${i}">Add to cart</button></div><div class="copy"><strong>${i + 1}. ${esc(p.title)}</strong><div class="price">${esc(money(p))}</div><p class="why">${esc(p.extra?.why || "")}</p></div>`;
    grid.appendChild(li);
  }
  const src = turn.search?.source;
  if (src) {
    meta.textContent = `${turn.search.suggestions.length} results · ${src}${turn.search.degraded ? " · degraded" : ""}`;
  } else {
    meta.textContent = (turn.products || []).length
      ? `${turn.products.length} products`
      : "Ask the shopper to search.";
  }
  cartEl.replaceChildren();
  const lines = turn.cart?.lines || [];
  for (const item of lines) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(`${item.quantity} × ${item.title}`)}</span><button type="button" class="remove" data-line="${esc(item.id)}">Remove</button>`;
    cartEl.appendChild(li);
  }
  const qty = lines.reduce((n, l) => n + l.quantity, 0);
  cartCount.textContent = qty ? `${qty} item${qty === 1 ? "" : "s"}` : "Empty";
  cartEmpty.hidden = lines.length > 0;
  if (turn.cart?.checkout_url) {
    checkout.hidden = false;
    checkout.href = turn.cart.checkout_url;
  } else {
    checkout.hidden = true;
    checkout.removeAttribute("href");
  }
}

async function send(message) {
  line("user", message);
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  const turn = await res.json();
  if (!res.ok) {
    line("agent", turn.error || "Request failed");
    return;
  }
  line("agent", turn.reply);
  render(turn);
}

async function addAt(index) {
  const res = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, index }),
  });
  const turn = await res.json();
  if (!res.ok) {
    line("agent", turn.error || "Could not add to cart");
    return;
  }
  line("agent", turn.reply);
  render(turn);
}

async function removeLine(lineId) {
  const res = await fetch("/api/cart/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, lineId }),
  });
  const turn = await res.json();
  if (!res.ok) {
    line("agent", turn.error || "Could not remove from cart");
    return;
  }
  render(turn);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  send(message);
});

for (const btn of document.querySelectorAll("[data-q]")) {
  btn.addEventListener("click", () => send(btn.getAttribute("data-q")));
}

grid.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest("[data-add]");
  if (!btn) return;
  addAt(Number(btn.dataset.add));
});

cartEl.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest("[data-line]");
  if (!btn) return;
  removeLine(btn.getAttribute("data-line"));
});

document.getElementById("clear").addEventListener("click", () => {
  log.replaceChildren();
});
