import { isSameOrigin, jsonResponse, methodNotAllowed, parseJsonBody, publicError } from "../lib/square.mjs";
import { createCheckout } from "../lib/shop.mjs";

// Re-checks the piece is still available (fresh from Square, not cached), then
// creates a Square-hosted checkout page and returns its URL for the browser to open.
export default async function handler(request) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isSameOrigin(request)) return jsonResponse(403, { error: "This request isn't allowed." });
  try {
    const { url } = await createCheckout(await parseJsonBody(request));
    return jsonResponse(200, { url });
  } catch (error) {
    const result = publicError(error);
    return jsonResponse(result.statusCode, { error: result.message });
  }
}
