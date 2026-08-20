/**
 * Stripe webhook — order notifications (Vercel Function)
 * ----------------------------------------------------------------------------
 * OPTIONAL. Stripe already emails you and the customer on every payment, so you
 * can launch without this. Add it when you want a packing slip in your inbox
 * rather than having to open the dashboard.
 *
 * SETUP
 *   1. Deploy, so this exists at https://yourdomain.co.nz/api/stripe-webhook
 *   2. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *        URL:    the address above
 *        Events: checkout.session.completed
 *   3. Copy the signing secret (whsec_...) into Vercel env vars as
 *        STRIPE_WEBHOOK_SECRET
 *   4. Optional email delivery — sign up at resend.com (free tier), then set:
 *        RESEND_API_KEY   = re_...
 *        ORDER_EMAIL_TO   = you@blairsbiltong.co.nz
 *        ORDER_EMAIL_FROM = orders@blairsbiltong.co.nz  (verified domain)
 *      Without these it just logs the order to the Vercel function log.
 *
 * NOTE: signature verification needs the RAW body, which is why this reads
 * `await request.text()` rather than `request.json()`.
 */

const STRIPE_API_VERSION = '2025-10-29.clover';
const money = cents => '$' + (cents / 100).toFixed(2);

/** True when the order came through with a local pickup code. */
export function isPickup(session) {
  return String(session?.metadata?.fulfilment || '').startsWith('LOCAL PICKUP');
}

export function formatOrder(session, lineItems) {
  const d = session.shipping_details || session.customer_details || {};
  const a = (d && d.address) || {};
  const lines = lineItems.map(li => `  ${li.quantity} x ${li.description}   ${money(li.amount_total)}`);
  const pickup = isPickup(session);

  // Pickup orders have no shipping address — say so loudly rather than printing
  // an empty SHIP TO block that looks like missing data.
  const destination = pickup
    ? [
        '*** LOCAL PICKUP — DO NOT POST ***',
        `  ${session.metadata?.local_code ? `Code: ${session.metadata.local_code}` : ''}`,
        `  ${session.customer_details?.name || d.name || '—'}`,
        '  Contact them to arrange collection.'
      ]
    : [
        'SHIP TO',
        `  ${d.name || '—'}`,
        `  ${a.line1 || ''}`,
        a.line2 ? `  ${a.line2}` : null,
        `  ${a.city || ''} ${a.postal_code || ''}`,
        `  ${a.country || ''}`
      ];

  return [
    `NEW ORDER — ${session.id.slice(-12)}`,
    pickup ? 'FULFILMENT: LOCAL PICKUP' : 'FULFILMENT: POST',
    '',
    'ITEMS',
    ...lines,
    '',
    `Subtotal   ${money(session.amount_subtotal)}`,
    `Shipping   ${money(session.total_details?.amount_shipping || 0)}`,
    `Discount   ${money(session.total_details?.amount_discount || 0)}`,
    `TOTAL      ${money(session.amount_total)}`,
    '',
    ...destination,
    '',
    'CONTACT',
    `  ${session.customer_details?.email || '—'}`,
    `  ${session.customer_details?.phone || '—'}`
  ].filter(l => l !== null).join('\n');   // keep '' — those are the blank spacer lines
}

async function sendEmail(subject, text) {
  const { RESEND_API_KEY: key, ORDER_EMAIL_TO: to, ORDER_EMAIL_FROM: from } = process.env;
  if (!key || !to || !from) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text })
  });
  if (!res.ok) {
    console.error('Resend failed:', res.status, await res.text());
    return false;
  }
  return true;
}

export async function POST(request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    console.error('Webhook env vars missing');
    return new Response('Not configured', { status: 500 });
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });

  const rawBody = await request.text();              // must be the raw string
  const signature = request.headers.get('stripe-signature');

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    console.warn('Bad webhook signature:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('Ignored', { status: 200 });
  }

  try {
    const session = event.data.object;
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 });
    const text = formatOrder(session, items.data);

    console.log(text);                       // always visible in the Vercel logs
    const tag = isPickup(session) ? 'PICKUP' : 'POST';
    await sendEmail(`New order (${tag}) — ${money(session.amount_total)}`, text);
  } catch (err) {
    // Log it, but still 200 — otherwise Stripe retries and you get duplicates.
    console.error('Order handling failed:', err && err.message);
  }

  return new Response('ok', { status: 200 });
}
