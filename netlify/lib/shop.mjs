import { randomUUID } from "node:crypto";
import { SquareError, squareRequest, SQUARE_LOCATION_ID } from "./square.mjs";

// Ted lists a piece for sale by adding it to the "Shop" category in Square.
// Adding it to "Pickup only" as well hides the shipping option (large pieces).
export const SHOP_CATEGORY = process.env.SQUARE_SHOP_CATEGORY || "Shop";
export const PICKUP_CATEGORY = process.env.SQUARE_PICKUP_CATEGORY || "Pickup only";
export const MAX_QUANTITY = 10;
const SITE_ORIGIN = process.env.PUBLIC_SITE_ORIGIN || "https://askremodel.com";

// Flat shipping charge in cents. Unset means shipping isn't offered yet (pickup only);
// "0" means free shipping.
export function shippingFeeCents(value = process.env.SQUARE_SHOP_SHIPPING_CENTS) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const cents = Number(value);
  return Number.isInteger(cents) && cents >= 0 ? cents : null;
}

function presentAt(object, locationId) {
  if (object.present_at_all_locations === false) {
    return (object.present_at_location_ids || []).includes(locationId);
  }
  return !(object.absent_at_location_ids || []).includes(locationId);
}

function categoryIdsOf(itemData) {
  return new Set([
    ...(itemData.categories || []).map((category) => category.id),
    itemData.category_id,
    itemData.reporting_category?.id,
  ].filter(Boolean));
}

function plainText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Picks the shop's items and sellable variations out of the raw catalog.
export function selectShopItems(objects, locationId = SQUARE_LOCATION_ID) {
  const categoryIds = (name) => new Set(objects
    .filter((object) => object.type === "CATEGORY" && !object.is_deleted
      && object.category_data?.name?.trim().toLowerCase() === name.trim().toLowerCase())
    .map((object) => object.id));
  const shopIds = categoryIds(SHOP_CATEGORY);
  const pickupIds = categoryIds(PICKUP_CATEGORY);
  const images = new Map(objects
    .filter((object) => object.type === "IMAGE" && object.image_data?.url)
    .map((object) => [object.id, object.image_data.url]));

  const items = [];
  for (const object of objects) {
    const data = object.item_data;
    if (object.type !== "ITEM" || object.is_deleted || !data || data.is_archived || !presentAt(object, locationId)) continue;
    const categories = categoryIdsOf(data);
    if (![...categories].some((id) => shopIds.has(id))) continue;

    const variations = (data.variations || []).flatMap((variation) => {
      const variationData = variation.item_variation_data;
      const price = variationData?.price_money;
      if (variation.type !== "ITEM_VARIATION" || variation.is_deleted || !variationData
          || variationData.sellable === false || variationData.pricing_type === "VARIABLE_PRICING"
          || !presentAt(variation, locationId)
          || price?.currency !== "USD" || !Number.isInteger(price.amount) || price.amount <= 0) {
        return [];
      }
      const override = (variationData.location_overrides || []).find((entry) => entry.location_id === locationId);
      return [{
        id: variation.id,
        name: variationData.name || "",
        priceCents: price.amount,
        tracksInventory: Boolean(override?.track_inventory ?? variationData.track_inventory),
        markedSoldOut: override?.sold_out === true,
      }];
    });
    if (!variations.length) continue;

    items.push({
      id: object.id,
      name: data.name || "Untitled piece",
      description: data.description_plaintext?.trim() || plainText(data.description),
      images: (data.image_ids || []).map((id) => images.get(id)).filter(Boolean),
      pickupOnly: [...categories].some((id) => pickupIds.has(id)),
      variations,
    });
  }
  return items;
}

// Adds stock (from Square inventory) and turns selected items into public listings.
export function toListings(items, stock = new Map()) {
  return items
    .map((item) => {
      const variations = item.variations.map((variation) => {
        const onHand = variation.tracksInventory ? Math.max(0, Math.floor(stock.get(variation.id) || 0)) : null;
        const available = !variation.markedSoldOut && (onHand === null || onHand > 0);
        return {
          id: variation.id,
          name: variation.name,
          priceCents: variation.priceCents,
          available,
          maxQuantity: available ? Math.min(MAX_QUANTITY, onHand ?? MAX_QUANTITY) : 0,
        };
      });
      const prices = variations.map((variation) => variation.priceCents);
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        images: item.images,
        pickupOnly: item.pickupOnly,
        oneOfAKind: variations.length === 1 && item.variations[0].tracksInventory && variations[0].maxQuantity <= 1,
        priceFromCents: Math.min(...prices),
        priceToCents: Math.max(...prices),
        soldOut: !variations.some((variation) => variation.available),
        variations,
      };
    })
    .sort((a, b) => Number(a.soldOut) - Number(b.soldOut) || a.name.localeCompare(b.name));
}

async function fetchCatalog(request) {
  const objects = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ types: "ITEM,IMAGE,CATEGORY" });
    if (cursor) query.set("cursor", cursor);
    const result = await request(`/v2/catalog/list?${query}`, { method: "GET" });
    objects.push(...(result.objects || []));
    cursor = result.cursor;
    if (!cursor) break;
  }
  return objects;
}

async function fetchStock(variationIds, request, locationId) {
  const stock = new Map();
  for (let start = 0; start < variationIds.length; start += 500) {
    let cursor;
    do {
      const result = await request("/v2/inventory/counts/batch-retrieve", {
        body: {
          catalog_object_ids: variationIds.slice(start, start + 500),
          location_ids: [locationId],
          states: ["IN_STOCK"],
          ...(cursor ? { cursor } : {}),
        },
      });
      for (const count of result.counts || []) {
        stock.set(count.catalog_object_id, (stock.get(count.catalog_object_id) || 0) + Number(count.quantity || 0));
      }
      cursor = result.cursor;
    } while (cursor);
  }
  return stock;
}

export async function loadListings({ request = squareRequest, locationId = SQUARE_LOCATION_ID } = {}) {
  const items = selectShopItems(await fetchCatalog(request), locationId);
  const tracked = items.flatMap((item) => item.variations.filter((v) => v.tracksInventory).map((v) => v.id));
  const stock = tracked.length ? await fetchStock(tracked, request, locationId) : new Map();
  return toListings(items, stock);
}

// Short-lived cache so a busy page doesn't call Square on every view. Checkout always reloads.
let cached = null;
export async function cachedListings(options) {
  if (cached && cached.expires > Date.now()) return cached.listings;
  const listings = await loadListings(options);
  cached = { listings, expires: Date.now() + 60 * 1000 };
  return listings;
}

export function validateCheckout(input) {
  const variationId = typeof input?.variationId === "string" ? input.variationId.trim() : "";
  const quantity = Number(input?.quantity ?? 1);
  const delivery = input?.delivery;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(variationId) || !Number.isInteger(quantity)
      || quantity < 1 || quantity > MAX_QUANTITY || !["ship", "pickup"].includes(delivery)) {
    throw new SquareError("Check your selection and try again.", 400);
  }
  return { variationId, quantity, delivery };
}

// Creates a Square-hosted checkout page for one listing and returns its URL.
export async function createCheckout(input, {
  request = squareRequest,
  listings,
  locationId = SQUARE_LOCATION_ID,
  shippingCents = shippingFeeCents(),
  origin = SITE_ORIGIN,
} = {}) {
  const { variationId, quantity, delivery } = validateCheckout(input);
  const all = listings || await loadListings({ request, locationId });
  const item = all.find((listing) => listing.variations.some((variation) => variation.id === variationId));
  const variation = item?.variations.find((entry) => entry.id === variationId);

  if (!item || !variation) throw new SquareError("That piece is no longer listed. Refresh the shop to see what's available.", 404);
  if (!variation.available) throw new SquareError("That piece just sold. Refresh the shop to see what's available.", 409);
  if (quantity > variation.maxQuantity) {
    throw new SquareError(`Only ${variation.maxQuantity} available. Lower the quantity and try again.`, 409);
  }
  const ship = delivery === "ship";
  if (ship && (item.pickupOnly || shippingCents === null)) {
    throw new SquareError("This piece is local pickup or delivery only.", 400);
  }

  const result = await request("/v2/online-checkout/payment-links", {
    body: {
      idempotency_key: randomUUID(),
      order: {
        location_id: locationId,
        line_items: [{
          catalog_object_id: variationId,
          quantity: String(quantity),
          ...(ship ? {} : { note: "Local pickup or delivery in Greater Cincinnati" }),
        }],
        pricing_options: { auto_apply_taxes: true },
      },
      checkout_options: {
        redirect_url: `${origin}/order-thanks${ship ? "" : "?delivery=pickup"}`,
        ask_for_shipping_address: ship,
        ...(ship && shippingCents > 0
          ? { shipping_fee: { name: "Shipping", charge: { amount: shippingCents, currency: "USD" } } }
          : {}),
        allow_tipping: false,
        enable_coupon: false,
        enable_loyalty: false,
      },
      payment_note: `askremodel.com shop: ${ship ? "ship to buyer" : "local pickup or delivery"}`,
    },
  });
  const url = result.payment_link?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new SquareError("Square couldn't start checkout. Please try again.", 502);
  }
  return { url, orderId: result.payment_link.order_id };
}
