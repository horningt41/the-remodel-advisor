# The Remodel Advisor

Static site for The Remodel Advisor, Ted's independent remodeling consulting business (Greater Cincinnati and virtual). Plain HTML/CSS/JS, no build step. Live at https://askremodel.com. Netlify publishes the repo root on every push to `main`.

## Structure

| File | What it is |
| --- | --- |
| `index.html` | Home: hero, services, how it works, about teaser, reviews, FAQ |
| `services.html` | Detail for each service, comparison table, scope (what's included and what isn't) |
| `book.html` | On-site booking and payment through Square (see below) |
| `documents.html` | Netlify form with file uploads for estimates, photos, and plans |
| `woodworking.html` | Custom woodworking: the shop (pieces for sale, from Square), what Ted makes to order, portfolio, materials, process, FAQ, and the `woodworking-request` Netlify form (thanks page: `woodworking-thanks.html`) |
| `piece.html` | One shop listing (`/piece?id=<Square item ID>`): photos, options, pickup or shipping, Buy Now |
| `order-thanks.html` | Where Square sends buyers after checkout |
| `about.html` | Ted's story, what he brings, project gallery |
| `terms.html`, `privacy.html` | Draft legal pages |
| `js/components.js` | Shared header/footer, icons, **site config** (`SITE`, `SERVICES`) |
| `css/styles.css` | All styles; design tokens are at the top |
| `assets/img/` | Logo SVGs (mark, horizontal, stacked; dark and light) and the OG image |

Shared pieces are filled in by JS: `<span data-icon="name">` becomes an icon, and `<div class="ph" data-ph="…">` becomes a photo placeholder. To use a real photo, replace the `.ph` div with an `<img>`.

## Before launch

- [ ] **Square booking:** Ted connects (or reconnects, to grant the new customer-lookup permission) his account using the setup link below, then makes and refunds one real test booking
- [ ] **Photos:** every "Photo needed" placeholder (hero, about, services, gallery)
- [ ] **Reviews:** replace the three "Sample review" cards on the home page with real ones, or remove the section
- [ ] **Shop:** reconnect Square (setup link below) to grant the shop permissions; in Square, create a `Shop` category and a `Pickup only` category, turn on sales tax for shop items, and add the first listings; set `SQUARE_SHOP_SHIPPING_CENTS` in Netlify to offer shipping
- [ ] **Woodworking page:** real photos with wood/size/finish captions, starting prices, deposit, lead times, delivery/shipping, guarantee, joinery, follow-up time (all flagged `.todo` or "Photo needed"); add an email notification for the `woodworking-request` form in Netlify
- [ ] **Copy flagged `.todo`:** travel radius, Ted's story, psychology background
- [ ] **Legal:** review `terms.html` and `privacy.html` and set effective dates
- [ ] **Email:** set `SITE.email` once there's a working address; add it to the Netlify form notifications
- [x] **Domain:** askremodel.com (Cloudflare Registrar; A `@` → 75.2.60.5 and CNAME `www` → the-remodel-advisor.netlify.app, both DNS-only/grey cloud)
- [ ] **Indexing:** remove the `X-Robots-Tag` block in `netlify.toml` and change `robots.txt` to allow crawling

### Square booking (on-site)

`book.html` runs the whole booking on askremodel.com: service, date and time, customer details, and Square's secure card field (Web Payments SDK). Netlify functions in `netlify/functions/` talk to Square:

| Function | Job |
| --- | --- |
| `square-config` | Tells the page whether Square is connected (`ready`) |
| `square-availability` | Open times for a service on a date |
| `square-service-area` | Tells the page whether an at-home address is within 25 miles of ZIP 45150, before the customer pays |
| `square-book` | Finds or creates the Square customer (by email), puts a hold on the card, creates the appointment, then captures the payment. A declined card never creates an appointment; if booking or capture fails, the hold is voided and the appointment released |
| `square-oauth-start` / `square-oauth-callback` | One-time connection to Ted's Square account (OAuth, buyer-level appointment scopes, so it works on Square Appointments Free; `CUSTOMERS_READ` lets it reuse returning customers instead of creating duplicates; `ITEMS_READ`, `INVENTORY_READ`, `ORDERS_READ` and `ORDERS_WRITE` run the shop) |

Netlify environment variables: `SQUARE_ENVIRONMENT=production`, `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_LOCATION_ID`, `SQUARE_OAUTH_SETUP_KEY` (password for the connect link, username `square-admin`), and optionally `SQUARE_MERCHANT_ID` to lock the connection to Ted's account. Tokens live in Netlify Blobs (`square-booking-production`) and refresh automatically.

To connect or reconnect: open `/.netlify/functions/square-oauth-start`, sign in with `square-admin` and the setup key, then approve in Square. You land on `/book?square=connected`.

If Square isn't connected, the page falls back to a "Continue to Square" button for the hosted booking page (links in `SITE.booking`). Prices are hard-coded in both `js/components.js` and `netlify/lib/square.mjs`, and must match Square. `tests/prices.test.mjs` checks the two files match, and Netlify runs `npm test` before every deploy, so a mismatch stops the deploy.

### Woodworking shop

Listings live in Square, not in this repo. To list a piece, add an item in Square (photos, description, price, one variation per size or wood) and put it in the **Shop** category. Also put it in **Pickup only** for large pieces that can't ship. For a one-of-a-kind piece, turn on inventory tracking with a stock of 1; it shows as Sold once bought. Archive an item to take it down. The site picks up changes within about a minute.

| Function | Job |
| --- | --- |
| `square-shop` | Public list of Shop items (or one, with `?id=`), with stock from Square inventory |
| `square-shop-checkout` | Re-checks stock, then creates a Square-hosted checkout page (Checkout API payment link) and returns its URL |

Buyers choose local pickup/delivery or shipping on the piece page. Shipping uses Square's address form and a flat `SQUARE_SHOP_SHIPPING_CENTS` charge (unset = no shipping offered, `0` = free). Taxes come from the tax settings on each Square item. Orders and payments appear in the Square Dashboard; pickup orders carry a "Local pickup or delivery" note. Optional overrides: `SQUARE_SHOP_CATEGORY`, `SQUARE_PICKUP_CATEGORY`.

## Local preview

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
