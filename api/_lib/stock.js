/**
 * Stock engine — everything that changes or reads bagged stock, batches and
 * supplies goes through here, so the dashboard, the shop, checkout and the
 * Stripe webhook all agree.
 *
 * How stock works:
 *   - Every change is a row in `movements` (+ in, − out) with a reason.
 *   - On hand for a bag size = the sum of its movements.
 *   - Stock is kept per batch, so every bag sold is tagged with the batch it
 *     came from. Sales take from the oldest batch first.
 */
import { q, tx, hasDb } from './db.js';
import { DEFAULT_SETTINGS } from './seed.js';
import { CATALOGUE, FLAVOURS, SIZES, SIZE_LABELS } from './catalogue.js';
import { sendMail, wrapEmail, esc, mailReady } from './mail.js';

export { hasDb };

export const OUT_REASONS = ['online', 'honesty', 'pickup', 'wholesale', 'sample', 'waste', 'staff', 'correction'];
export const IN_REASONS = ['packed', 'return', 'correction'];
export const REASON_LABELS = {
  packed: 'Packed', online: 'Online order', honesty: 'Honesty box', pickup: 'Picked up / paid in person',
  wholesale: 'Wholesale', sample: 'Sample / giveaway', waste: 'Wastage', staff: 'Eaten / staff',
  return: 'Returned', correction: 'Correction', stocktake: 'Stocktake'
};

export const skuLabel = sku => {
  const [f, g] = sku.split('-');
  return `${FLAVOURS[f]?.label || f} ${g}g`;
};
export const priceOf = sku => CATALOGUE[sku]?.cents ?? null;

/* ---------------------------------------------------------------- settings */
export async function getSettings(c) {
  const { rows } = await (c || { query: q }).query('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
export async function setSettings(c, patch) {
  for (const [k, v] of Object.entries(patch)) {
    await c.query(`INSERT INTO settings (key, value) VALUES ($1,$2)
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
  }
}

/* ---------------------------------------------------------------- reading stock */
/** Rows of { sku, batch_id, qty } for every non-zero lot. */
export async function lots(c) {
  const { rows } = await (c || { query: q }).query(`
    SELECT m.sku, m.batch_id, SUM(m.qty)::int AS qty, b.code, b.best_before, b.packed_on
      FROM movements m LEFT JOIN batches b ON b.id = m.batch_id
     GROUP BY m.sku, m.batch_id, b.code, b.best_before, b.packed_on
    HAVING SUM(m.qty) <> 0
     ORDER BY m.sku, b.best_before NULLS FIRST, m.batch_id NULLS FIRST`);
  return rows;
}

export async function onHand(c) {
  const { rows } = await (c || { query: q }).query(`SELECT sku, COALESCE(SUM(qty),0)::int AS qty FROM movements GROUP BY sku`);
  const out = Object.fromEntries(Object.keys(CATALOGUE).map(s => [s, 0]));
  for (const r of rows) out[r.sku] = r.qty;
  return out;
}

/* ---------------------------------------------------------------- writing stock */
/** Put bags into stock. */
export async function addStock(c, { sku, qty, batchId = null, reason, note = null, ref = null, at = null }) {
  if (!CATALOGUE[sku]) throw new Error(`Unknown product ${sku}`);
  if (!(qty > 0)) return [];
  const { rows } = await c.query(
    `INSERT INTO movements (sku, batch_id, qty, reason, note, ref, at) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now())) RETURNING id`,
    [sku, batchId, qty, reason, note, ref, at]);
  return rows.map(r => r.id);
}

/**
 * Take bags out of stock, oldest batch first. If there aren't enough recorded
 * bags (e.g. before your first stocktake) the rest is still logged so sales
 * are never lost — stock just shows negative until you count it.
 */
export async function takeStock(c, { sku, qty, reason, unitCents = null, ref = null, customer = null, note = null, batchId = null }) {
  if (!CATALOGUE[sku]) throw new Error(`Unknown product ${sku}`);
  if (!(qty > 0)) return [];
  const ids = [];
  const insert = async (bid, n) => {
    const { rows } = await c.query(
      `INSERT INTO movements (sku, batch_id, qty, reason, unit_cents, ref, customer, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [sku, bid, -n, reason, unitCents, ref, customer, note]);
    ids.push(rows[0].id);
  };
  let left = qty;
  if (batchId) {           // you said which batch it came from
    await insert(batchId, left);
    return ids;
  }
  const available = (await lots(c)).filter(l => l.sku === sku && l.qty > 0);
  for (const lot of available) {
    if (left <= 0) break;
    const n = Math.min(left, lot.qty);
    await insert(lot.batch_id, n);
    left -= n;
  }
  if (left > 0) await insert(null, left);
  return ids;
}

/** Set a bag size to an exact counted number. */
export async function countTo(c, { sku, counted, reasonIfShort = 'honesty', ref }) {
  const have = (await onHand(c))[sku] ?? 0;
  const diff = counted - have;
  if (diff < 0) {
    const unit = ['honesty', 'pickup'].includes(reasonIfShort) ? priceOf(sku) : null;
    await takeStock(c, { sku, qty: -diff, reason: reasonIfShort, unitCents: unit, ref, note: 'From stocktake' });
  } else if (diff > 0) {
    await addStock(c, { sku, qty: diff, reason: 'correction', ref, note: 'Stocktake found extra' });
  }
  return diff;
}

/* ---------------------------------------------------------------- shop */
/**
 * What the public shop is allowed to know: in stock or not, and a number only
 * when it's low. `live` false means "not using tracked stock yet".
 */
export async function availability() {
  const s = await getSettings();
  const { rows: prods } = await q('SELECT sku, hidden FROM products');
  const have = await onHand();
  const items = {};
  for (const p of prods) {
    if (!CATALOGUE[p.sku]) continue;
    const n = have[p.sku] ?? 0;
    const available = s.live ? (!p.hidden && n > 0) : (!p.hidden && !CATALOGUE[p.sku].soldOut);
    items[p.sku] = { available, left: s.live && available && n <= s.showLeftUnder ? n : null };
  }
  return { live: Boolean(s.live), items };
}

export async function isLive() {
  if (!hasDb()) return false;
  return Boolean((await getSettings()).live);
}

/** Throws OUT_OF_STOCK:<sku>:<left> if the cart wants more than we have. */
export async function checkCart(lines) {
  const a = await availability();
  if (!a.live) return;
  const have = await onHand();
  for (const { sku, qty } of lines) {
    const item = a.items[sku];
    if (!item?.available) throw new Error(`OUT_OF_STOCK:${sku}:0`);
    if (qty > have[sku]) throw new Error(`OUT_OF_STOCK:${sku}:${have[sku]}`);
  }
}

/* ---------------------------------------------------------------- Stripe orders */
/** "2x original-100, 1x original-50" → [{sku, qty}] */
export function parsePackList(s) {
  return String(s || '').split(',').map(x => x.trim().match(/^(\d+)x ([a-z0-9-]+)$/))
    .filter(Boolean).map(m => ({ qty: Number(m[1]), sku: m[2] })).filter(l => CATALOGUE[l.sku]);
}

/** Record a paid checkout as stock out. Safe to call twice for the same order. */
export async function recordOrder(session) {
  const lines = parsePackList(session?.metadata?.pack_list);
  if (!lines.length) return { skipped: 'no items' };
  const pickup = String(session?.metadata?.fulfilment || '').startsWith('LOCAL PICKUP');
  const who = [session.customer_details?.name, session.customer_details?.email].filter(Boolean).join(' · ');
  const done = await tx(async c => {
    const r = await c.query(`INSERT INTO processed_orders (session_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING session_id`, [session.id]);
    if (!r.rows.length) return false;
    for (const l of lines) {
      await takeStock(c, { sku: l.sku, qty: l.qty, reason: 'online', unitCents: priceOf(l.sku),
        ref: session.id, customer: who || null, note: pickup ? 'Local pickup' : null });
    }
    return true;
  });
  if (done) await checkAlerts().catch(err => console.error('Alert check failed:', err.message));
  return { recorded: done, lines };
}

/** Batch codes each order's bags came from: { sessionId: ['B003', …] } */
export async function batchesForOrders(sessionIds) {
  if (!sessionIds.length) return {};
  const { rows } = await q(`SELECT DISTINCT m.ref, b.code FROM movements m JOIN batches b ON b.id = m.batch_id
                             WHERE m.ref = ANY($1) ORDER BY b.code`, [sessionIds]);
  const out = {};
  for (const r of rows) (out[r.ref] ||= []).push(r.code);
  return out;
}

/* ---------------------------------------------------------------- supplies */
export async function moveSupply(c, { id, qty, reason, batchId = null, costCents = null, note = null }) {
  if (!qty) return;
  const { rows } = await c.query('SELECT cost_cents FROM supplies WHERE id = $1', [id]);
  if (!rows.length) throw new Error('Unknown supply');
  // Receiving with a price updates the cost per unit (weighted toward the new price).
  let cost = rows[0].cost_cents;
  if (reason === 'received' && costCents != null) {
    cost = costCents;
    await c.query('UPDATE supplies SET cost_cents = $2 WHERE id = $1', [id, cost]);
  }
  await c.query(`INSERT INTO supply_moves (supply_id, qty, reason, batch_id, cost_cents, note) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, qty, reason, batchId, cost, note]);
  await c.query('UPDATE supplies SET on_hand = on_hand + $2 WHERE id = $1', [id, qty]);
}

/** Take ingredients for a batch (per raw kg) or packaging for bags packed. */
export async function useSuppliesFor(c, { batchId, rawKg = 0, bags = {} }) {
  const { rows } = await c.query(`SELECT id, auto_use, use_per FROM supplies WHERE NOT archived AND auto_use IS NOT NULL`);
  for (const s of rows) {
    let used = 0;
    if (s.auto_use === 'raw-kg') used = rawKg * s.use_per;
    else if (s.auto_use === 'bag-any') used = Object.values(bags).reduce((a, b) => a + b, 0) * s.use_per;
    else if (s.auto_use === 'bag-100+') used = ((bags[100] || 0) + (bags[200] || 0)) * s.use_per;
    else if (s.auto_use?.startsWith('bag-')) used = (bags[Number(s.auto_use.slice(4))] || 0) * s.use_per;
    if (used > 0) await moveSupply(c, { id: s.id, qty: -Math.round(used * 100) / 100, reason: rawKg ? 'batch' : 'packed', batchId });
  }
}

/* ---------------------------------------------------------------- batches */
export async function nextBatchCode(c) {
  const { rows } = await c.query(`SELECT code FROM batches`);
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.code).replace(/\D/g, '')) || 0), 0);
  return 'B' + String(max + 1).padStart(3, '0');
}

export function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function todayNZ() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}

/** Cost of a batch so far: meat + ingredients + packaging used. In cents. */
export async function batchCost(c, batchId) {
  const { rows: [b] } = await c.query('SELECT meat_cost_cents FROM batches WHERE id = $1', [batchId]);
  const { rows: [s] } = await c.query(
    `SELECT COALESCE(SUM(-qty * COALESCE(cost_cents,0)),0)::float AS cents,
            BOOL_OR(cost_cents IS NULL) AS missing FROM supply_moves WHERE batch_id = $1`, [batchId]);
  return {
    meat: b?.meat_cost_cents ?? null,
    supplies: Math.round(s.cents),
    total: (b?.meat_cost_cents ?? 0) + Math.round(s.cents),
    complete: b?.meat_cost_cents != null,       // meat is the big one; enough for a real figure
    missingSupplyCosts: Boolean(s.missing)       // some supplies have no price entered yet
  };
}

/* ---------------------------------------------------------------- alerts */
/**
 * Emails you once when a bag size drops to its low level (or a supply hits its
 * reorder level), and not again until it's been restocked above it.
 */
export async function checkAlerts() {
  const s = await getSettings();
  const have = await onHand();
  const { rows: prods } = await q('SELECT sku, low_at, hidden FROM products');
  const { rows: sups } = await q('SELECT id, name, unit, on_hand, reorder_at FROM supplies WHERE NOT archived AND reorder_at IS NOT NULL');
  const flagged = s.alerted || {};
  const fresh = [];
  const next = {};

  for (const p of prods) {
    if (p.hidden || !CATALOGUE[p.sku]) continue;
    const low = have[p.sku] <= p.low_at;
    const key = 'p:' + p.sku;
    if (low) { next[key] = true; if (!flagged[key]) fresh.push(`${skuLabel(p.sku)}: ${have[p.sku]} bag${have[p.sku] === 1 ? '' : 's'} left`); }
  }
  for (const x of sups) {
    const key = 's:' + x.id;
    if (x.on_hand <= x.reorder_at) { next[key] = true; if (!flagged[key]) fresh.push(`${x.name}: ${x.on_hand} ${x.unit} left (reorder at ${x.reorder_at})`); }
  }
  await tx(c => setSettings(c, { alerted: next }));
  if (!fresh.length || !s.emailAlerts || !mailReady() || !s.live) return fresh;

  const html = wrapEmail('Running low', [
    `<p style="margin:0 0 12px">These just dropped to their low level:</p>`,
    `<ul style="margin:0 0 16px;padding-left:18px">${fresh.map(f => `<li style="margin:4px 0">${esc(f)}</li>`).join('')}</ul>`,
    `<p style="margin:0">Open the Dispatch app to see everything.</p>`
  ]);
  await sendMail({ subject: `Low stock: ${fresh.length} item${fresh.length > 1 ? 's' : ''}`, html, text: fresh.join('\n') });
  return fresh;
}

export const meta = { FLAVOURS, SIZES, SIZE_LABELS };
