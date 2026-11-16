import assert from "node:assert/strict";
import test from "node:test";
import { SERVICES, SquareError } from "../netlify/lib/square.mjs";
import { reserveAndCharge } from "../netlify/functions/square-book.mjs";

const input = {
  service: SERVICES["estimate-review"],
  givenName: "Ada",
  familyName: "Lovelace",
  email: "ada@example.com",
  phone: "+1 513 555 0100",
  sourceId: "cnon:card-nonce-ok",
  idempotencyKey: "1b671a64-40d5-491e-99b0-da01ff1f3341",
  locationType: "VIDEO_CONFERENCE",
  address: null,
};
const slot = { start_at: "2030-01-02T15:00:00Z" };
const segment = {
  duration_minutes: 60,
  service_variation_id: SERVICES["estimate-review"].variationId,
  service_variation_version: 1,
  team_member_id: "TM1",
};

const declined = () => { throw new SquareError("declined", 400, ["CARD_DECLINED"]); };
const networkDown = () => { throw new SquareError("unreachable", 503, [], true); };

// A stand-in for squareRequest: routes each Square API path to a handler and records the call order.
function fakeSquare(overrides = {}) {
  const calls = [];
  const routes = {
    "/v2/customers/search": () => ({ customers: [{ id: "CUST_EXISTING" }] }),
    "/v2/customers": () => ({ customer: { id: "CUST_NEW" } }),
    "/v2/payments": () => ({ payment: { id: "PAY1", status: "APPROVED" } }),
    "/v2/bookings": () => ({ booking: { id: "BOOK1", version: 0, start_at: slot.start_at } }),
    "/v2/payments/PAY1/complete": () => ({ payment: { id: "PAY1", status: "COMPLETED" } }),
    "/v2/payments/PAY1/cancel": () => ({ payment: { id: "PAY1", status: "CANCELED" } }),
    "/v2/bookings/BOOK1/cancel": () => ({ booking: { id: "BOOK1" } }),
    ...overrides,
  };
  const request = async (path, options) => {
    calls.push({ path, body: options?.body });
    const route = routes[path];
    if (!route) throw new Error(`Unexpected Square call: ${path}`);
    return route(options);
  };
  return { request, calls, paths: () => calls.map((call) => call.path) };
}

test("authorizes the card before booking, then captures the payment", async () => {
  const square = fakeSquare();
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 200);
  assert.deepEqual(square.paths(), [
    "/v2/customers/search",
    "/v2/payments",
    "/v2/bookings",
    "/v2/payments/PAY1/complete",
  ]);
  const authorize = square.calls[1].body;
  assert.equal(authorize.autocomplete, false);
  assert.equal(authorize.amount_money.amount, 5000);
  assert.equal(authorize.customer_id, "CUST_EXISTING");
  assert.equal(square.calls[2].body.booking.customer_id, "CUST_EXISTING");
});

test("creates a customer when none matches the email", async () => {
  const square = fakeSquare({ "/v2/customers/search": () => ({}) });
  await reserveAndCharge(input, slot, segment, square.request);
  assert.deepEqual(square.paths().slice(0, 2), ["/v2/customers/search", "/v2/customers"]);
  assert.equal(square.calls[2].body.customer_id, "CUST_NEW");
});

test("still books when customer search isn't permitted yet", async () => {
  const square = fakeSquare({
    "/v2/customers/search": () => { throw new SquareError("forbidden", 403, ["INSUFFICIENT_SCOPES"]); },
  });
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 200);
  assert.ok(square.paths().includes("/v2/customers"));
});

test("a declined card never creates an appointment", async () => {
  const square = fakeSquare({ "/v2/payments": declined });
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 402);
  assert.equal((await response.json()).retryable, true);
  assert.equal(square.paths().includes("/v2/bookings"), false);
});

test("an unconfirmed authorization stops before booking and asks the customer to call", async () => {
  const square = fakeSquare({ "/v2/payments": networkDown });
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).pending, true);
  assert.equal(square.paths().includes("/v2/bookings"), false);
});

test("voids the card hold when the appointment can't be created", async () => {
  const square = fakeSquare({ "/v2/bookings": () => { throw new SquareError("taken", 400, ["BAD_REQUEST"]); } });
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).retryable, true);
  assert.ok(square.paths().includes("/v2/payments/PAY1/cancel"));
  assert.equal(square.paths().includes("/v2/payments/PAY1/complete"), false);
});

test("releases the appointment and the hold when capture fails", async () => {
  const square = fakeSquare({
    "/v2/payments/PAY1/complete": () => { throw new SquareError("failed", 400, ["PAYMENT_NOT_COMPLETABLE"]); },
  });
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 402);
  assert.equal((await response.json()).retryable, true);
  assert.ok(square.paths().includes("/v2/bookings/BOOK1/cancel"));
  assert.ok(square.paths().includes("/v2/payments/PAY1/cancel"));
});

test("asks the customer to call if the hold can't be voided", async () => {
  const square = fakeSquare({
    "/v2/bookings": () => { throw new SquareError("taken", 400, ["BAD_REQUEST"]); },
    "/v2/payments/PAY1/cancel": declined,
  });
  const response = await reserveAndCharge(input, slot, segment, square.request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).pending, true);
});
