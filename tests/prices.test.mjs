import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SERVICES } from "../netlify/lib/square.mjs";

// Prices and lengths live in two places: js/components.js (what visitors see)
// and netlify/lib/square.mjs (what the card is charged). This keeps them in step;
// Netlify runs it before every deploy.
test("site prices and lengths match what the booking function charges", async () => {
  const source = await readFile(new URL("../js/components.js", import.meta.url), "utf8");
  const pattern = /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*length:\s*"(\d+) hours?",\s*price:\s*(\d+)/g;
  const site = Object.fromEntries(
    [...source.matchAll(pattern)].map(([, id, name, hours, price]) => [id, { name, hours: Number(hours), price: Number(price) }]),
  );

  assert.deepEqual(Object.keys(site).sort(), Object.keys(SERVICES).sort(), "components.js and square.mjs list different services");
  for (const [id, service] of Object.entries(SERVICES)) {
    assert.equal(site[id].name, service.name, `${id}: name differs`);
    assert.equal(site[id].price * 100, service.priceCents, `${id}: price differs`);
    assert.equal(site[id].hours * 60, service.durationMinutes, `${id}: length differs`);
  }
});
