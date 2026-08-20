/**
 * Stripe Checkout Session — Vercel Function
 * ----------------------------------------------------------------------------
 * Takes the cart from the browser, prices it SERVER-SIDE (never trust prices
 * sent by the client), and returns a Stripe-hosted checkout URL.
 *
 * Full setup walkthrough: see STRIPE-SETUP.md in the project root.
 *
 * Quick version:
 *   1. Vercel → Project → Settings → Environment Variables:
 *        STRIPE_SECRET_KEY = sk_test_...  (swap to sk_live_... when ready)
 *        SITE_URL          = https://blairsbiltong.co.nz
 *   2. In index.html set CONFIG.checkoutMode = 'checkout-session'
 *   3. Push, then test with card 4242 4242 4242 4242
 */

import { checkCode } from './local-codes.js';

// Pinned so a future Stripe API release can't silently change behaviour.
const STRIPE_API_VERSION = '2025-10-29.clover';

/* ---------------------------------------------------------------------------
   CATALOGUE — prices in CENTS. Must mirror PRODUCTS in index.html.
   This is the source of truth for what a customer is charged.
   --------------------------------------------------------------------------- */
export const CATALOGUE = {
  original: { name: "Blair's Biltong — Original (50g)", cents: 750 },
  dryheat:  { name: "Blair's Biltong — Dry Heat (50g)", cents: 750 }
};

const FREE_SHIPPING_OVER_CENTS = 5000;   // $50.00
const FLAT_SHIPPING_CENTS      = 500;    // $5.00
const MAX_QTY_PER_LINE         = 20;
const MAX_LINES                = 10;

/* ---------------------------------------------------------------------------
   Payload builder — exported so it can be unit tested without hitting Stripe
   --------------------------------------------------------------------------- */
export function buildSessionPayload(items, siteUrl, rawCode) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('EMPTY_CART');
  if (items.length > MAX_LINES) throw new Error('TOO_MANY_LINES');

  // Collapse duplicate ids so someone can't sneak the same product through twice.
  const merged = new Map();
  for (const raw of items) {
    const id = String(raw && raw.id);
    if (!Object.prototype.hasOwnProperty.call(CATALOGUE, id)) {
      throw new Error(`UNKNOWN_PRODUCT:${id}`);
    }
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new Error(`BAD_QUANTITY:${id}`);
    merged.set(id, Math.min(MAX_QTY_PER_LINE, (merged.get(id) || 0) + qty));
  }

  let subtotal = 0;
  const line_items = [];
  const summary = [];

  for (const [id, quantity] of merged) {
    const product = CATALOGUE[id];
    subtotal += product.cents * quantity;
    summary.push(`${quantity}x ${id}`);
    line_items.push({
      quantity,
      price_data: {
        currency: 'nzd',
        unit_amount: product.cents,
        product_data: { name: product.name, metadata: { sku: id } }
      }
    });
  }

  // Local pickup code: no freight, because you're handing it over in person.
  const localCode = checkCode(rawCode);
  const shippingCents = localCode ? 0
    : (subtotal >= FREE_SHIPPING_OVER_CENTS ? 0 : FLAT_SHIPPING_CENTS);

  const shippingName = localCode ? 'Local pickup — no delivery'
    : (shippingCents === 0 ? 'Free shipping' : 'NZ Post tracked');

  const shippingRate = {
    type: 'fixed_amount',
    display_name: shippingName,
    fixed_amount: { amount: shippingCents, currency: 'nzd' }
  };
  // A pickup order isn't being posted, so a delivery estimate would be a lie.
  if (!localCode) {
    shippingRate.delivery_estimate = {
      minimum: { unit: 'business_day', value: 2 },
      maximum: { unit: 'business_day', value: 5 }
    };
  }

  return {
    mode: 'payment',
    line_items,
    allow_promotion_codes: true,
    customer_creation: 'always',
    // Pickup orders aren't posted anywhere, so don't make the customer type a
    // delivery address they'd never use — and don't record one that would make
    // the order look postable. Delivery orders collect it as normal.
    ...(localCode ? {} : {
      shipping_address_collection: { allowed_countries: ['NZ'] },
      shipping_options: [{ shipping_rate_data: shippingRate }]
    }),
    phone_number_collection: { enabled: true },
    // Shows up on the Stripe dashboard order — handy when you're packing.
    // fulfilment makes it obvious at a glance whether to post it or not.
    metadata: {
      pack_list: summary.join(', '),
      subtotal_cents: String(subtotal),
      fulfilment: localCode ? `LOCAL PICKUP (${localCode}) — DO NOT POST` : 'Post',
      ...(localCode ? { local_code: localCode } : {})
    },
    // The pickup flag is cosmetic — it only swaps the wording on the success
    // page. Nothing is trusted from it, so it doesn't matter that it's visible.
    success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}${localCode ? '&pickup=1' : ''}`,
    cancel_url:  `${siteUrl}/#shop`
  };
}

/* ---------------------------------------------------------------------------
   Handler
   --------------------------------------------------------------------------- */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

export async function POST(request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SITE_URL) {
    console.error('Missing STRIPE_SECRET_KEY or SITE_URL');
    return json({ error: 'Checkout is not configured' }, 500);
  }

  const siteUrl = process.env.SITE_URL.replace(/\/+$/, '');

  let payload;
  try {
    const { items, code } = await request.json();
    payload = buildSessionPayload(items, siteUrl, code);
  } catch (err) {
    // Client's fault — say so, but don't leak internals.
    console.warn('Rejected cart:', err.message);
    return json({ error: 'That cart looks invalid. Please refresh and try again.' }, 400);
  }

  try {
    // Imported lazily so this file can be unit tested without installing Stripe,
    // and so the cold start doesn't pay for it on a rejected cart.
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 15000
    });
    const session = await stripe.checkout.sessions.create(payload);
    return json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err && err.message);
    return json({ error: 'Could not start checkout. Please try again shortly.' }, 502);
  }
}

export async function GET() {
  return json({ error: 'Method not allowed' }, 405);
}
