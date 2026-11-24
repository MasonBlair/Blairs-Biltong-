/**
 * Real money per online order, straight from Stripe: what the customer paid,
 * discounts, shipping they paid, Stripe's fee, refunds and what reached your
 * bank. Plus what you paid NZ Post, entered on the dispatch page.
 *
 * Read-only with Stripe: nothing here charges, refunds or changes a payment.
 */
import { q } from './db.js';

const isPickupSession = s => String(s?.metadata?.fulfilment || '').startsWith('LOCAL PICKUP');

/** Stripe's fee and refunds for one payment. Null fee if Stripe hasn't settled it yet. */
async function feeFor(stripe, piId) {
  if (!piId) return { fee: null, refunded: 0 };
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge.balance_transaction'] });
  const ch = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const bt = ch?.balance_transaction && typeof ch.balance_transaction === 'object' ? ch.balance_transaction : null;
  return { fee: bt ? bt.fee : null, refunded: ch?.amount_refunded || 0 };
}

/** Save (or update) one paid checkout's money. Safe to call more than once. */
export async function recordFinance(stripe, s) {
  if (!s || s.payment_status !== 'paid') return null;
  const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  let fee = null, refunded = 0;
  try { ({ fee, refunded } = await feeFor(stripe, piId)); } catch (err) { console.error('Fee lookup failed:', err.message); }
  const td = s.total_details || {};
  const who = [s.customer_details?.name, s.customer_details?.email].filter(Boolean).join(' · ') || null;
  await q(`
    INSERT INTO order_finance (session_id, at, paid_cents, subtotal_cents, discount_cents, shipping_cents, fee_cents, refunded_cents, pickup, customer)
    VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (session_id) DO UPDATE SET
      paid_cents = EXCLUDED.paid_cents, subtotal_cents = EXCLUDED.subtotal_cents, discount_cents = EXCLUDED.discount_cents,
      shipping_cents = EXCLUDED.shipping_cents, fee_cents = COALESCE(EXCLUDED.fee_cents, order_finance.fee_cents),
      refunded_cents = EXCLUDED.refunded_cents, pickup = EXCLUDED.pickup, customer = EXCLUDED.customer`,
    [s.id, s.created, s.amount_total || 0, s.amount_subtotal || 0, td.amount_discount || 0, td.amount_shipping || 0,
      fee, refunded, isPickupSession(s), who]);
  return { fee, refunded };
}

/**
 * Catch up: any paid order in the last `days` that isn't saved yet, plus any
 * saved order whose Stripe fee hadn't come through. Runs when the app opens.
 */
export async function syncFinance(stripe, { days = 90 } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const { rows } = await q(`SELECT session_id, fee_cents FROM order_finance WHERE at > to_timestamp($1)`, [since]);
  const known = new Map(rows.map(r => [r.session_id, r.fee_cents]));
  let added = 0, fees = 0;
  for await (const s of stripe.checkout.sessions.list({ limit: 100, created: { gte: since } })) {
    if (s.payment_status !== 'paid') continue;
    if (!known.has(s.id)) { await recordFinance(stripe, s); added++; }
    // Fee not in yet, or recent enough that a refund may have happened since.
    else if (known.get(s.id) == null || s.created > Date.now() / 1000 - 14 * 86400) { await recordFinance(stripe, s); fees++; }
  }
  return { added, updated: fees };
}

/** What you paid NZ Post for an order. Cents, or null to clear. */
export async function setPostage(sessionId, cents) {
  const { rowCount } = await q(`UPDATE order_finance SET postage_cents = $2 WHERE session_id = $1`, [sessionId, cents]);
  return rowCount > 0;
}

export async function postageFor(sessionIds) {
  if (!sessionIds.length) return {};
  const { rows } = await q(`SELECT session_id, postage_cents FROM order_finance WHERE session_id = ANY($1)`, [sessionIds]);
  return Object.fromEntries(rows.map(r => [r.session_id, r.postage_cents]));
}

/** Rows for the Numbers tab (last 120 days). */
export async function financeRows() {
  const { rows } = await q(`SELECT session_id, (at AT TIME ZONE 'Pacific/Auckland')::date AS d, paid_cents, subtotal_cents,
      discount_cents, shipping_cents, fee_cents, refunded_cents, postage_cents, pickup
    FROM order_finance WHERE at > now() - interval '120 days'`);
  return rows;
}
