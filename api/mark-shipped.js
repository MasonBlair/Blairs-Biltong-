/**
 * Private: send the "on its way" email and mark the order shipped — Vercel Function
 * ----------------------------------------------------------------------------
 * POST /api/mark-shipped   (header x-dispatch-key: <DISPATCH_PASSWORD>)
 * body: { sessionId, tracking, note?, test?, resend?, markOnly? }
 *
 *   markOnly: true → no email; just marks the order shipped (for orders you
 *                    posted before this page existed). Tracking is optional.
 *   test: true   → sends the email to ORDER_EMAIL_TO (you) only, marks nothing.
 *   resend: true → allows sending again for an order already marked shipped.
 *
 * Vercel env vars needed:
 *   STRIPE_SECRET_KEY   (already set for checkout)
 *   RESEND_API_KEY      re_...
 *   ORDER_EMAIL_FROM    Blair's Biltong <orders@blairsbiltong.co.nz>
 *   ORDER_EMAIL_TO      orders@blairsbiltong.co.nz   (test sends + replies go here)
 *   DISPATCH_PASSWORD   anything long that only you know
 */
import { json, authorised, stripeClient, shippingOf, isPickup } from './_lib/admin.js';
import { buildShippedEmail } from './_lib/shipped-email.js';

const SAMPLE_SESSION = {
  id: 'cs_sample_000000SAMPLE1', amount_total: 3250,
  customer_details: { name: 'Sample Customer' },
  shipping_details: { name: 'Sample Customer', address: { line1: '1 Example Street', city: 'Queenstown', postal_code: '9300' } },
  total_details: { amount_shipping: 500, amount_discount: 0 }
};
const SAMPLE_ITEMS = [
  { description: 'Original Biltong 100 g', quantity: 2, amount_total: 1500 },
  { description: 'Original Biltong 50 g', quantity: 1, amount_total: 750 }
];

export async function POST(request) {
  if (!authorised(request)) return json({ error: 'Wrong password' }, 401);

  const { RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_EMAIL_TO } = process.env;
  if (!RESEND_API_KEY || !ORDER_EMAIL_FROM || !ORDER_EMAIL_TO) {
    return json({ error: 'Email settings missing in Vercel (RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_EMAIL_TO)' }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const sessionId = String(body.sessionId || '');
  const tracking = String(body.tracking || '').replace(/\s+/g, '').toUpperCase();
  const note = String(body.note || '').trim().slice(0, 300);
  const test = body.test === true;

  const send = (to, subject, e) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: ORDER_EMAIL_FROM, to: [to], reply_to: ORDER_EMAIL_TO, subject, html: e.html, text: e.text })
  });

  // Sample email to yourself — works before any real order exists.
  if (body.sample === true) {
    const e = buildShippedEmail(SAMPLE_SESSION, SAMPLE_ITEMS, { tracking: 'LY123456789NZ', note });
    const r = await send(ORDER_EMAIL_TO, `[SAMPLE] ${e.subject}`, e);
    if (!r.ok) return json({ error: `Email didn’t send (${r.status}). ${(await r.text()).slice(0, 200)}` }, 502);
    return json({ ok: true, test: true, sentTo: ORDER_EMAIL_TO });
  }

  if (!sessionId.startsWith('cs_')) return json({ error: 'Missing order' }, 400);

  // Already posted some other way: mark it shipped without emailing anyone.
  if (body.markOnly === true) {
    if (tracking && !/^[A-Z0-9]{8,30}$/.test(tracking)) return json({ error: 'That tracking number doesn’t look right' }, 400);
    const stripe = await stripeClient();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s.payment_status !== 'paid' || !s.payment_intent) return json({ error: 'That order isn’t paid' }, 400);
    const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent.id;
    const shippedAt = new Date().toISOString();
    await stripe.paymentIntents.update(piId, { metadata: { shipped_at: shippedAt, tracking: tracking || 'sent-manually' } });
    return json({ ok: true, markOnly: true, shippedAt });
  }

  if (!/^[A-Z0-9]{8,30}$/.test(tracking)) return json({ error: 'That tracking number doesn’t look right' }, 400);

  const stripe = await stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  if (session.payment_status !== 'paid') return json({ error: 'That order isn’t paid' }, 400);
  if (isPickup(session)) return json({ error: 'That’s a pickup order — nothing to post' }, 400);

  const pi = typeof session.payment_intent === 'object' ? session.payment_intent : null;
  if (!test && pi?.metadata?.shipped_at && body.resend !== true) {
    return json({ error: 'already_shipped', shippedAt: pi.metadata.shipped_at, tracking: pi.metadata.tracking }, 409);
  }

  const customer = session.customer_details?.email;
  if (!customer) return json({ error: 'No customer email on this order' }, 400);

  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 50 });
  // The template reads shipping_details; newer API versions keep it elsewhere.
  const forEmail = { ...session, shipping_details: shippingOf(session) };
  const email = buildShippedEmail(forEmail, items.data, { tracking, note });

  const res = await send(test ? ORDER_EMAIL_TO : customer,
    test ? `[TEST] ${email.subject}` : email.subject, email);
  if (!res.ok) {
    const detail = await res.text();
    console.error('Resend failed:', res.status, detail);
    return json({ error: `Email didn’t send (${res.status}). ${detail.slice(0, 200)}` }, 502);
  }

  if (test) return json({ ok: true, test: true, sentTo: ORDER_EMAIL_TO });

  const shippedAt = new Date().toISOString();
  if (pi) {
    await stripe.paymentIntents.update(pi.id, { metadata: { shipped_at: shippedAt, tracking } });
  }
  return json({ ok: true, sentTo: customer, shippedAt, tracking });
}
