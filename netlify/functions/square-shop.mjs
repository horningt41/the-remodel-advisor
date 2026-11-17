import { hasSquareConfig, jsonResponse, methodNotAllowed, SquareError } from "../lib/square.mjs";
import { cachedListings, shippingExtraCents, shippingFeeCents } from "../lib/shop.mjs";

// Public list of pieces for sale, read from the "Shop" category in Square.
// ?id=ITEM_ID returns just that piece.
export default async function handler(request) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!hasSquareConfig()) return jsonResponse(503, { error: "The shop isn't connected yet." });

  try {
    // Tax ids are only needed at checkout; keep them out of the public listing.
    const listings = (await cachedListings()).map(({ taxIds, ...listing }) => listing);
    const shippingCents = shippingFeeCents();
    const shipping = { offered: shippingCents !== null, feeCents: shippingCents, extraCents: shippingExtraCents() };
    const id = new URL(request.url).searchParams.get("id");
    const headers = { "Cache-Control": "public, max-age=60" };

    if (id) {
      const item = listings.find((listing) => listing.id === id);
      if (!item) return jsonResponse(404, { error: "That piece isn't listed anymore." });
      return jsonResponse(200, { item, shipping }, headers);
    }
    return jsonResponse(200, { items: listings, shipping }, headers);
  } catch (error) {
    const codes = error instanceof SquareError ? error.codes : [];
    console.error("Shop listings could not be loaded", { codes });
    return jsonResponse(503, {
      error: codes.includes("INSUFFICIENT_SCOPES")
        ? "The shop isn't connected yet."
        : "The shop couldn't load right now. Please try again shortly.",
    });
  }
}
