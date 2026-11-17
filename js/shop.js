/* ==========================================================================
   Shop: fills the shop grid on /woodworking and the piece page (/piece?id=…)
   from the square-shop function. Listings are managed in Square, not here.
   ========================================================================== */
(function () {
  "use strict";

  const PHONE = "(513) 409-1625";
  const money = (cents) => "$" + (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  const priceLabel = (item) => item.priceFromCents === item.priceToCents
    ? money(item.priceFromCents)
    : "From " + money(item.priceFromCents);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children || []) if (child) node.append(child);
    return node;
  }

  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "The shop couldn't load right now.");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function tagsFor(item) {
    const tags = [];
    if (item.soldOut) tags.push(el("span", { class: "shop-tag shop-tag--sold", text: "Sold" }));
    else if (item.oneOfAKind) tags.push(el("span", { class: "shop-tag shop-tag--one", text: "One of a kind" }));
    if (item.pickupOnly && !item.soldOut) tags.push(el("span", { class: "shop-tag", text: "Pickup only" }));
    return tags;
  }

  /* ---------- Shop grid (woodworking page) ---------- */
  async function renderGrid(grid, status) {
    try {
      const { items } = await getJson("/.netlify/functions/square-shop");
      if (!items.length) {
        status.replaceChildren(
          "Nothing is listed right now. New pieces go up as they come out of the shop. ",
          el("a", { href: "#request", text: "Request a custom piece" }),
          " in the meantime.",
        );
        return;
      }
      grid.replaceChildren(...items.map((item) => {
        const media = el("div", { class: "shop-card__media" }, [
          item.images[0]
            ? el("img", { src: item.images[0], alt: item.name, loading: "lazy", decoding: "async" })
            : el("span", { class: "shop-card__empty", text: "Photo coming soon" }),
          el("div", { class: "shop-card__tags" }, tagsFor(item)),
        ]);
        return el("a", {
          class: "shop-card" + (item.soldOut ? " shop-card--sold" : ""),
          href: "/piece?id=" + encodeURIComponent(item.id),
        }, [
          media,
          el("div", { class: "shop-card__body" }, [
            el("h3", { class: "shop-card__name", text: item.name }),
            el("span", { class: "shop-card__price", text: item.soldOut ? money(item.priceFromCents) : priceLabel(item) }),
          ]),
        ]);
      }));
      grid.hidden = false;
      status.hidden = true;
    } catch {
      status.replaceChildren(
        "Pieces for sale will be listed here. Until then, ",
        el("a", { href: "#request", text: "request a custom piece" }),
        " or call " + PHONE + ".",
      );
    }
  }

  /* ---------- Piece page ---------- */
  async function renderPiece(root) {
    const status = document.getElementById("piece-status");
    const id = new URLSearchParams(location.search).get("id");
    if (!id) {
      status.textContent = "That piece couldn't be found. Browse the shop to see what's available.";
      return;
    }

    let item;
    let shipping;
    try {
      ({ item, shipping } = await getJson("/.netlify/functions/square-shop?id=" + encodeURIComponent(id)));
    } catch (error) {
      status.textContent = error.status === 404
        ? "That piece isn't listed anymore. It may have sold. Browse the shop to see what's available."
        : "This piece couldn't load right now. Please try again shortly, or call " + PHONE + ".";
      return;
    }

    document.title = item.name + " | The Remodel Advisor";
    document.getElementById("piece-name").textContent = item.name;
    document.getElementById("piece-crumb").textContent = item.name;
    const desc = document.getElementById("piece-desc");
    desc.textContent = item.description;
    desc.hidden = !item.description;

    // Photos
    const main = document.getElementById("piece-main");
    const thumbs = document.getElementById("piece-thumbs");
    if (item.images.length) {
      const show = (index) => {
        main.replaceChildren(el("img", { src: item.images[index], alt: item.name + (item.images.length > 1 ? ", photo " + (index + 1) : "") }));
        for (const [i, button] of [...thumbs.children].entries()) button.setAttribute("aria-pressed", String(i === index));
      };
      if (item.images.length > 1) {
        thumbs.replaceChildren(...item.images.map((src, index) => {
          const button = el("button", { type: "button", class: "piece__thumb", "aria-label": "Show photo " + (index + 1) }, [
            el("img", { src, alt: "", loading: "lazy" }),
          ]);
          button.addEventListener("click", () => show(index));
          return button;
        }));
      }
      show(0);
    } else {
      main.replaceChildren(el("span", { class: "shop-card__empty", text: "Photo coming soon" }));
    }

    // Buy panel
    const price = document.getElementById("piece-price");
    const form = document.getElementById("piece-form");
    const variationField = document.getElementById("variation-field");
    const variationSelect = document.getElementById("piece-variation");
    const quantityField = document.getElementById("quantity-field");
    const quantitySelect = document.getElementById("piece-quantity");
    const shipOption = document.getElementById("delivery-ship");
    const shipLabel = document.getElementById("delivery-ship-label");
    const shipNote = document.getElementById("delivery-ship-note");
    const pickupOption = document.getElementById("delivery-pickup");
    const shipToField = document.getElementById("shipto-field");
    const buy = document.getElementById("piece-buy");
    const buyStatus = document.getElementById("buy-status");
    const tags = document.getElementById("piece-tags");
    tags.replaceChildren(...tagsFor(item));

    const available = item.variations.filter((variation) => variation.available);
    if (item.variations.length > 1) {
      variationSelect.replaceChildren(...item.variations.map((variation) => el("option", {
        value: variation.id,
        disabled: !variation.available,
        text: variation.name + " · " + money(variation.priceCents) + (variation.available ? "" : " (sold out)"),
      })));
      if (available[0]) variationSelect.value = available[0].id;
      variationField.hidden = false;
    }

    const selected = () => item.variations.find((variation) => variation.id === (item.variations.length > 1 ? variationSelect.value : item.variations[0].id));

    function syncVariation() {
      const variation = selected();
      price.textContent = money(variation.priceCents);
      const max = variation.available ? variation.maxQuantity : 0;
      quantitySelect.replaceChildren(...Array.from({ length: Math.max(max, 1) }, (_, i) => el("option", { value: String(i + 1), text: String(i + 1) })));
      quantityField.hidden = max <= 1;
    }
    variationSelect.addEventListener("change", syncVariation);
    syncVariation();

    const canShip = shipping.offered && !item.pickupOnly;
    if (canShip) {
      shipLabel.textContent = shipping.feeCents ? "Ship it to me (" + money(shipping.feeCents) + ")" : "Ship it to me (free)";
      shipNote.textContent = "You'll enter the address at checkout.";
    } else {
      shipOption.disabled = true;
      shipLabel.textContent = "Shipping";
      shipNote.textContent = item.pickupOnly ? "Not available for this piece." : "Not available yet.";
      pickupOption.checked = true;
    }

    // Shipping asks Ohio or another state: Ohio addresses pay Ohio sales tax, others don't.
    const syncDelivery = () => { shipToField.hidden = !shipOption.checked; };
    for (const option of [shipOption, pickupOption]) option.addEventListener("change", syncDelivery);
    syncDelivery();

    if (item.soldOut) {
      buy.disabled = true;
      buy.textContent = "Sold";
      buyStatus.textContent = "This piece has sold. Want something like it? Request a custom version below.";
      buyStatus.hidden = false;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const variation = selected();
      if (!variation?.available) return;
      const delivery = form.querySelector('input[name="delivery"]:checked').value;
      const shipTo = form.querySelector('input[name="shipTo"]:checked')?.value;
      if (delivery === "ship" && !shipTo) {
        buyStatus.hidden = false;
        buyStatus.className = "booking-status booking-status--error";
        buyStatus.textContent = "Choose whether it's shipping to Ohio or another state.";
        document.getElementById("shipto-ohio").focus();
        return;
      }
      buy.disabled = true;
      buyStatus.hidden = false;
      buyStatus.className = "booking-status";
      buyStatus.textContent = "Opening secure checkout…";
      try {
        const response = await fetch("/.netlify/functions/square-shop-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            variationId: variation.id,
            quantity: Number(quantitySelect.value || 1),
            delivery,
            ...(delivery === "ship" ? { shipTo } : {}),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) throw new Error(result.error || "Checkout couldn't start. Please try again.");
        location.href = result.url;
      } catch (error) {
        buyStatus.className = "booking-status booking-status--error";
        buyStatus.textContent = error.message || "Checkout couldn't start. Please try again.";
        buy.disabled = false;
      }
    });

    status.hidden = true;
    root.hidden = false;
  }

  function start() {
    const grid = document.getElementById("shop-grid");
    if (grid) renderGrid(grid, document.getElementById("shop-status"));
    const piece = document.getElementById("piece");
    if (piece) renderPiece(piece);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
