const sessionId = crypto.randomUUID();
const log = document.getElementById("log");
const grid = document.getElementById("grid");
const cartEl = document.getElementById("cart");
const meta = document.getElementById("meta");
const checkout = document.getElementById("checkout");
const form = document.getElementById("form");
const input = document.getElementById("input");

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
    li.innerHTML = `
      <img alt="" src="${p.image_url || ""}" />
      <div>
        <strong>${i + 1}. ${p.title}</strong>
        <div>${money(p)}</div>
        <p class="why">${p.extra?.why || ""}</p>
      </div>`;
    grid.appendChild(li);
  }
  const src = turn.search?.source;
  meta.textContent = src
    ? `${turn.search.suggestions.length} hits · ${src}${turn.search.degraded ? " · degraded" : ""}`
    : "";
  cartEl.replaceChildren();
  for (const lineItem of turn.cart?.lines || []) {
    const li = document.createElement("li");
    li.innerHTML = `<div></div><div>${lineItem.quantity} × ${lineItem.title}</div>`;
    cartEl.appendChild(li);
  }
  if (turn.cart?.checkout_url) {
    checkout.hidden = false;
    checkout.href = turn.cart.checkout_url;
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
