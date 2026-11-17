import assert from "node:assert/strict";
import test from "node:test";
import { SquareError } from "../netlify/lib/square.mjs";
import { createCheckout, loadListings, selectShopItems, shippingExtraCents, shippingFeeCents, shippingFor, toListings } from "../netlify/lib/shop.mjs";

const LOC = "LOC1";
const category = (id, name) => ({ type: "CATEGORY", id, category_data: { name } });
const variation = (id, amount, extra = {}) => ({
  type: "ITEM_VARIATION",
  id,
  item_variation_data: { name: extra.name ?? "Regular", pricing_type: "FIXED_PRICING", price_money: { amount, currency: "USD" }, ...extra.data },
  ...extra.object,
});
const item = (id, name, categories, variations, extra = {}) => ({
  type: "ITEM",
  id,
  item_data: { name, categories: categories.map((cid) => ({ id: cid })), variations, ...extra },
});

const catalog = [
  category("CAT_SHOP", "Shop"),
  category("CAT_PICKUP", "Pickup only"),
  category("CAT_OTHER", "Services"),
  { type: "IMAGE", id: "IMG1", image_data: { url: "https://items-images.example/board.jpg" } },
  { type: "TAX", id: "TAX_OH", tax_data: { name: "Sales Tax", percentage: "6.75", enabled: true } },
  { type: "TAX", id: "TAX_OFF", tax_data: { name: "Old Tax", percentage: "5.75", enabled: false } },
  item("ITEM_BOARD", "Walnut End-Grain Board", ["CAT_SHOP"], [
    variation("VAR_BOARD_S", 9000, { name: "12 x 18 in" }),
    variation("VAR_BOARD_L", 14000, { name: "16 x 22 in" }),
  ], { image_ids: ["IMG1"], description_plaintext: "Walnut, mineral oil finish.", tax_ids: ["TAX_OH", "TAX_OFF"] }),
  item("ITEM_TABLE", "Live-Edge Coffee Table", ["CAT_SHOP", "CAT_PICKUP"], [
    variation("VAR_TABLE", 120000, { data: { track_inventory: true } }),
  ], { description: "<p>Cherry slab</p><p>Steel legs</p>", tax_ids: ["TAX_OH"] }),
  item("ITEM_SOLD", "Maple Bench", ["CAT_SHOP"], [variation("VAR_SOLD", 45000, { data: { track_inventory: true } })]),
  item("ITEM_ARCHIVED", "Old Listing", ["CAT_SHOP"], [variation("VAR_OLD", 1000)], { is_archived: true }),
  item("ITEM_SERVICE", "Estimate Review", ["CAT_OTHER"], [variation("VAR_SVC", 5000)]),
  item("ITEM_ELSEWHERE", "Other Location", ["CAT_SHOP"], [variation("VAR_ELSE", 1000)]),
  item("ITEM_VARIABLE", "Ask for Price", ["CAT_SHOP"], [variation("VAR_VAR", 0, { data: { pricing_type: "VARIABLE_PRICING", price_money: undefined } })]),
];
catalog.find((object) => object.id === "ITEM_ELSEWHERE").present_at_all_locations = false;

const stock = new Map([["VAR_TABLE", 1], ["VAR_SOLD", 0]]);
const listings = () => toListings(selectShopItems(catalog, LOC), stock);

test("lists only live items in the Shop category at this location", () => {
  assert.deepEqual(listings().map((listing) => listing.id), ["ITEM_TABLE", "ITEM_BOARD", "ITEM_SOLD"]);
});

test("describes each listing for the page", () => {
  const [table, board, bench] = listings();
  assert.equal(board.priceFromCents, 9000);
  assert.equal(board.priceToCents, 14000);
  assert.deepEqual(board.images, ["https://items-images.example/board.jpg"]);
  assert.equal(board.description, "Walnut, mineral oil finish.");
  assert.equal(board.variations[0].maxQuantity, 10);
  assert.equal(board.oneOfAKind, false);
  assert.deepEqual(board.taxIds, ["TAX_OH"], "disabled taxes are dropped");

  assert.equal(table.pickupOnly, true);
  assert.equal(table.oneOfAKind, true);
  assert.equal(table.description, "Cherry slab\n\nSteel legs");
  assert.equal(table.variations[0].maxQuantity, 1);

  assert.equal(bench.soldOut, true);
  assert.equal(bench.variations[0].available, false);
});

test("honors Square's sold-out switch even without inventory tracking", () => {
  const items = selectShopItems([
    category("CAT_SHOP", "Shop"),
    item("ITEM_X", "Coasters", ["CAT_SHOP"], [variation("VAR_X", 3000, {
      data: { location_overrides: [{ location_id: LOC, sold_out: true }] },
    })]),
  ], LOC);
  assert.equal(toListings(items)[0].soldOut, true);
});

test("reads the shipping charge from settings", () => {
  assert.equal(shippingFeeCents(undefined), null);
  assert.equal(shippingFeeCents(""), null);
  assert.equal(shippingFeeCents("0"), 0);
  assert.equal(shippingFeeCents("1500"), 1500);
  assert.equal(shippingFeeCents("12.50"), null);
  assert.equal(shippingExtraCents(undefined), 0);
  assert.equal(shippingExtraCents("500"), 500);
  assert.equal(shippingFor(1, 1000, 500), 1000);
  assert.equal(shippingFor(4, 1000, 500), 2500);
  assert.equal(shippingFor(3, null, 500), null);
});

test("loads the catalog and stock from Square", async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push(path);
    if (path.startsWith("/v2/catalog/list")) return { objects: catalog };
    if (path === "/v2/inventory/counts/batch-retrieve") {
      assert.deepEqual(options.body.catalog_object_ids.sort(), ["VAR_SOLD", "VAR_TABLE"]);
      return { counts: [{ catalog_object_id: "VAR_TABLE", quantity: "1" }] };
    }
    throw new Error(`Unexpected call ${path}`);
  };
  const result = await loadListings({ request, locationId: LOC });
  assert.equal(result.find((listing) => listing.id === "ITEM_SOLD").soldOut, true);
  assert.equal(result.find((listing) => listing.id === "ITEM_TABLE").soldOut, false);
  assert.equal(calls.length, 2);
});

function fakeCheckout() {
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, body: options.body });
    return { payment_link: { url: "https://square.link/u/abc123", order_id: "ORDER1" } };
  };
  return { request, calls };
}

const checkoutOptions = (square) => ({ request: square.request, listings: listings(), locationId: LOC, shippingCents: 1500, extraShippingCents: 0, origin: "https://askremodel.com" });
const OHIO_TAX = [{ uid: "tax-0", catalog_object_id: "TAX_OH", scope: "ORDER" }];

test("ships within Ohio with Ohio tax on the piece and the shipping", async () => {
  const square = fakeCheckout();
  const result = await createCheckout({ variationId: "VAR_BOARD_L", quantity: 2, delivery: "ship", shipTo: "ohio" }, checkoutOptions(square));
  assert.equal(result.url, "https://square.link/u/abc123");
  assert.equal(square.calls[0].path, "/v2/online-checkout/payment-links");
  const { order, checkout_options: options } = square.calls[0].body;
  assert.equal(order.line_items[0].catalog_object_id, "VAR_BOARD_L");
  assert.equal(order.line_items[0].quantity, "2");
  assert.match(order.line_items[0].note, /Ohio address/);
  assert.deepEqual(order.taxes, OHIO_TAX);
  assert.equal("pricing_options" in order, false, "taxes are set explicitly, not auto-applied");
  assert.deepEqual(order.service_charges, [{
    uid: "shipping", name: "Shipping", amount_money: { amount: 1500, currency: "USD" },
    calculation_phase: "SUBTOTAL_PHASE", taxable: true,
  }]);
  assert.equal(options.ask_for_shipping_address, true);
  assert.equal("shipping_fee" in options, false);
  assert.equal(options.redirect_url, "https://askremodel.com/order-thanks");
});

test("ships to another state without Ohio tax", async () => {
  const square = fakeCheckout();
  await createCheckout({ variationId: "VAR_BOARD_S", quantity: 1, delivery: "ship", shipTo: "other" }, checkoutOptions(square));
  const { order, payment_note: note } = square.calls[0].body;
  assert.deepEqual(order.taxes, []);
  assert.equal(order.service_charges[0].taxable, false);
  assert.match(order.line_items[0].note, /outside Ohio/);
  assert.match(note, /outside ohio/);
});

test("charges Ohio tax on pickup, with no shipping", async () => {
  const square = fakeCheckout();
  await createCheckout({ variationId: "VAR_TABLE", quantity: 1, delivery: "pickup", shipTo: "other" }, checkoutOptions(square));
  const { order, checkout_options: options } = square.calls[0].body;
  assert.deepEqual(order.taxes, OHIO_TAX, "shipTo is ignored for pickup");
  assert.equal("service_charges" in order, false);
  assert.equal(options.ask_for_shipping_address, false);
  assert.match(order.line_items[0].note, /pickup/i);
  assert.equal(options.redirect_url, "https://askremodel.com/order-thanks?delivery=pickup");
});

test("adds the extra shipping charge for each piece after the first", async () => {
  const square = fakeCheckout();
  await createCheckout({ variationId: "VAR_BOARD_S", quantity: 3, delivery: "ship", shipTo: "other" }, { ...checkoutOptions(square), shippingCents: 1000, extraShippingCents: 500 });
  assert.equal(square.calls[0].body.order.service_charges[0].amount_money.amount, 2000);
});

test("free shipping adds no shipping charge", async () => {
  const square = fakeCheckout();
  await createCheckout({ variationId: "VAR_BOARD_S", quantity: 1, delivery: "ship", shipTo: "ohio" }, { ...checkoutOptions(square), shippingCents: 0 });
  assert.equal("service_charges" in square.calls[0].body.order, false);
  assert.deepEqual(square.calls[0].body.order.taxes, OHIO_TAX);
});

test("refuses checkouts the shop can't fill", async () => {
  const square = fakeCheckout();
  const options = { request: square.request, listings: listings(), locationId: LOC, shippingCents: 1500 };
  const rejects = (input, pattern) => assert.rejects(
    createCheckout(input, options),
    (error) => error instanceof SquareError && pattern.test(error.message),
  );
  await rejects({ variationId: "VAR_SOLD", quantity: 1, delivery: "pickup" }, /just sold/);
  await rejects({ variationId: "VAR_TABLE", quantity: 2, delivery: "pickup" }, /Only 1 available/);
  await rejects({ variationId: "VAR_TABLE", quantity: 1, delivery: "ship", shipTo: "ohio" }, /pickup or delivery only/);
  await rejects({ variationId: "VAR_BOARD_S", quantity: 1, delivery: "ship" }, /Ohio or another state/);
  await rejects({ variationId: "VAR_BOARD_S", quantity: 1, delivery: "ship", shipTo: "texas" }, /Ohio or another state/);
  await rejects({ variationId: "VAR_SVC", quantity: 1, delivery: "pickup" }, /no longer listed/);
  await rejects({ variationId: "VAR_BOARD_S", quantity: 0, delivery: "pickup" }, /Check your selection/);
  await assert.rejects(
    createCheckout({ variationId: "VAR_BOARD_S", quantity: 1, delivery: "ship", shipTo: "ohio" }, { ...options, shippingCents: null }),
    /pickup or delivery only/,
  );
  assert.equal(square.calls.length, 0);
});
