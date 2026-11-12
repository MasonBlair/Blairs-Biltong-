/**
 * Private: list recent paid orders for the dispatch page — Vercel Function
 * ----------------------------------------------------------------------------
 * GET /api/orders   (header x-dispatch-key: <DISPATCH_PASSWORD>)
 *
 * Returns paid, posted (not pickup) orders from the last 60 days, newest first,
 * each flagged shipped / not shipped. "Shipped" is stored on the Stripe payment
 * as metadata (shipped_at, tracking), so Stripe stays the single record.
 */
import { json, authorised, stripeClient, shippingOf, isPickup } from './_lib/admin.js';

export async function GET(request) {
  if (!authorised(request)) return json({ error: 'Wrong password' }, 401);
  if (!process.env.STRIPE_SECRET_KEY) return json({ error: 'Stripe key missing in Vercel' }, 500);

  const stripe = await stripeClient();
  const since = Math.floor(Date.now() / 1000) - 60 * 24 * 3600;

  const sessions = await stripe.checkout.sessions.list({
    limit: 50,
    created: { gte: since },
    expand: ['data.payment_intent']
  });

  const paid = sessions.data.filter(s => s.payment_status === 'paid' && !isPickup(s));

  const orders = await Promise.all(paid.map(async s => {
    const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 50 });
    const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null;
    const ship = shippingOf(s) || {};
    const a = ship.address || {};
    return {
      id: s.id,
      ref: s.id.slice(-8).toUpperCase(),
      created: s.created,
      name: s.customer_details?.name || ship.name || '',
      email: s.customer_details?.email || '',
      total: s.amount_total,
      items: items.data.map(li => ({ qty: li.quantity, desc: li.description })),
      address: [ship.name, a.line1, a.line2, [a.city, a.postal_code].filter(Boolean).join(' ')].filter(Boolean),
      shippedAt: pi?.metadata?.shipped_at || null,
      tracking: pi?.metadata?.tracking || null
    };
  }));

  return json({ orders });
}
