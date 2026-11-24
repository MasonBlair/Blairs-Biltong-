/**
 * Private: the boss dashboard's data — Vercel Function
 * ----------------------------------------------------------------------------
 * GET  /api/boss                 everything the dashboard shows, in one go
 * GET  /api/boss?batch=12        one batch in full, incl. where every bag went
 * GET  /api/boss?sku=original-50 one bag size: lots + history
 * POST /api/boss  { action, … }  make a change (see ACTIONS below)
 *
 * Same password as the dispatch page (header x-dispatch-key).
 * Needs DATABASE_URL (add a Neon database in Vercel → Storage).
 */
import { json, authorised, stripeClient } from './_lib/admin.js';
import { q, tx, hasDb } from './_lib/db.js';
import {
  getSettings, setSettings, lots, onHand, addStock, takeStock, countTo, moveSupply, useSuppliesFor,
  nextBatchCode, addMonths, todayNZ, batchCost, checkAlerts, skuLabel, priceOf, recordOrder,
  OUT_REASONS, IN_REASONS, REASON_LABELS, meta
} from './_lib/stock.js';
import { CATALOGUE } from './_lib/catalogue.js';
import { mailReady, sendMail, wrapEmail, esc } from './_lib/mail.js';
import {
  saveRecord, voidRecord, skipReminder, saveFsSettings, safetySummary, safetyView, batchRecord,
  printToken, readPrintToken, printHtml, exportAll
} from './_lib/safety-db.js';
import { syncFinance, financeRows } from './_lib/finance.js';
import { savePostage, postageCents } from './mark-shipped.js';

const SALE_REASONS = ['online', 'honesty', 'pickup', 'wholesale'];
const BAG_SIZES = Object.keys(meta.SIZES).map(Number);
const day = 86_400_000;
const addDays = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * day).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / day);
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };
const num = v => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const clean = (v, n = 300) => (v == null ? null : String(v).trim().slice(0, n) || null);

class UserError extends Error {}
const fail = m => { throw new UserError(m); };

/* ========================================================================= GET */
export async function GET(request) {
  const url = new URL(request.url);
  // Verifier printout / backup: opened in Safari from a short-lived signed link.
  if (url.searchParams.get('print') || url.searchParams.get('export')) {
    const t = readPrintToken(url.searchParams.get('print') || url.searchParams.get('export'));
    if (!t || !hasDb()) return new Response('This link has expired. Make a new one from the Safety tab.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (url.searchParams.get('print')) {
      return new Response(await printHtml(t.from, t.to), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    return new Response(JSON.stringify(await exportAll(), null, 1), { headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="blairs-biltong-backup-${todayNZ()}.json"` } });
  }
  if (!authorised(request)) return json({ error: 'Wrong password' }, 401);
  if (!hasDb()) return json({ error: 'no_db' }, 503);
  try {
    if (url.searchParams.get('safety')) return json(await safetyView());
    if (url.searchParams.get('record')) return json(await batchRecord(int(url.searchParams.get('record'))));
    if (url.searchParams.get('batch')) return json(await batchDetail(int(url.searchParams.get('batch'))));
    if (url.searchParams.get('sku')) return json(await skuDetail(url.searchParams.get('sku')));
    if (url.searchParams.get('supply')) return json(await supplyDetail(int(url.searchParams.get('supply'))));
    return json(await overview());
  } catch (err) {
    console.error('boss GET failed:', err);
    return json({ error: 'Couldn’t load the dashboard. ' + (err.message || '') }, 500);
  }
}

export async function overview() {
  const today = todayNZ();
  const s = await getSettings();
  const [have, lotRows, { rows: prods }, { rows: batchRows }, { rows: supplies }, { rows: recent }, { rows: wl }, { rows: sales }]
    = await Promise.all([
      onHand(), lots(),
      q('SELECT * FROM products ORDER BY flavour, grams'),
      q(`SELECT b.*,
            COALESCE((SELECT json_object_agg(g, n) FROM (
               SELECT split_part(sku,'-',2) AS g, SUM(qty)::int AS n FROM movements
                WHERE batch_id = b.id AND reason = 'packed' GROUP BY 1) x), '{}') AS packed,
            COALESCE((SELECT json_object_agg(g, n) FROM (
               SELECT split_part(sku,'-',2) AS g, SUM(qty)::int AS n FROM movements
                WHERE batch_id = b.id GROUP BY 1) y), '{}') AS remaining
           FROM batches b
          ORDER BY (b.status = 'closed'), b.started_on DESC, b.id DESC LIMIT 60`),
      q('SELECT * FROM supplies WHERE NOT archived ORDER BY sort, name'),
      q(`SELECT m.*, b.code FROM movements m LEFT JOIN batches b ON b.id = m.batch_id ORDER BY m.at DESC, m.id DESC LIMIT 40`),
      q(`SELECT flavour, COUNT(*)::int AS n FROM waitlist WHERE notified_at IS NULL GROUP BY flavour`),
      q(`SELECT (at AT TIME ZONE 'Pacific/Auckland')::date AS d, sku, reason, ref,
                SUM(-qty)::int AS units, SUM(-qty * COALESCE(unit_cents,0))::int AS cents
           FROM movements WHERE qty < 0 AND reason = ANY($1) AND at > now() - interval '120 days'
          GROUP BY 1,2,3,4`, [SALE_REASONS])
    ]);
  const money = await financeRows();

  const products = prods.filter(p => CATALOGUE[p.sku]).map(p => ({
    sku: p.sku, flavour: p.flavour, grams: p.grams, label: skuLabel(p.sku), price: priceOf(p.sku),
    lowAt: p.low_at, hidden: p.hidden, onHand: have[p.sku] ?? 0,
    lots: lotRows.filter(l => l.sku === p.sku).map(l => ({ batchId: l.batch_id, code: l.code, qty: l.qty, bestBefore: l.best_before }))
  }));

  // All batch costs in one go (meat + supplies used), rather than one query per batch.
  const { rows: costRows } = batchRows.length ? await q(
    `SELECT batch_id, COALESCE(SUM(-qty * COALESCE(cost_cents,0)),0)::float AS cents, BOOL_OR(cost_cents IS NULL) AS missing
       FROM supply_moves WHERE batch_id = ANY($1) GROUP BY batch_id`, [batchRows.map(b => b.id)]) : { rows: [] };
  const costOf = b => {
    const c = costRows.find(r => r.batch_id === b.id) || { cents: 0, missing: false };
    return { meat: b.meat_cost_cents ?? null, supplies: Math.round(c.cents), total: (b.meat_cost_cents ?? 0) + Math.round(c.cents),
      complete: b.meat_cost_cents != null, missingSupplyCosts: Boolean(c.missing) };
  };
  const batches = await Promise.all(batchRows.map(async b => {
    const packedBags = Object.values(b.packed).reduce((a, n) => a + n, 0);
    const packedGrams = Object.entries(b.packed).reduce((a, [g, n]) => a + g * n, 0);
    const remainingBags = Object.values(b.remaining).reduce((a, n) => a + Math.max(0, n), 0);
    const cost = costOf(b);
    return {
      ...b, packedBags, packedGrams, remainingBags,
      yieldPct: packedGrams && b.raw_kg ? Math.round(packedGrams / (b.raw_kg * 10)) : null,
      lossPct: b.dried_kg && b.raw_kg ? Math.round((1 - b.dried_kg / b.raw_kg) * 1000) / 10 : null,
      cost, costPer100g: packedGrams && cost.complete ? Math.round(cost.total / packedGrams * 100) : null
    };
  }));

  const numbers = buildNumbers({ today, sales, products, batches, settings: s, money });
  const safety = await safetySummary(batches.map(b => b.id));
  const alerts = buildAlerts({ today, products, batches, supplies, settings: s, numbers, safety });

  return {
    today, settings: s, mailReady: mailReady(),
    flavours: Object.entries(meta.FLAVOURS).map(([id, f]) => ({ id, label: f.label })),
    sizes: BAG_SIZES.map(g => ({ grams: g, label: meta.SIZE_LABELS[g], cents: meta.SIZES[g] })),
    reasons: { out: OUT_REASONS, in: IN_REASONS, labels: REASON_LABELS },
    products, batches, supplies, numbers, alerts, safety,
    recent: recent.map(m => ({ ...m, label: skuLabel(m.sku), reasonLabel: REASON_LABELS[m.reason] || m.reason })),
    waitlist: Object.fromEntries(wl.map(r => [r.flavour, r.n]))
  };
}

/* ---------------------------------------------------------------- numbers */
function buildNumbers({ today, sales, products, batches, settings, money = [] }) {
  const gramsOf = sku => Number(sku.split('-')[1]);
  const inRange = (d, n) => daysBetween(d, today) < n;

  // Online orders Stripe has told us about: use what was really paid, not list prices.
  const moneyIds = new Set(money.map(m => m.session_id));
  const listCents = rows => rows.filter(r => !(r.reason === 'online' && moneyIds.has(r.ref))).reduce((a, r) => a + r.cents, 0);
  const paidCents = rows => rows.reduce((a, m) => a + m.paid_cents - m.refunded_cents, 0);

  const period = n => {
    const rows = sales.filter(r => inRange(r.d, n));
    const mrows = money.filter(m => inRange(m.d, n));
    const by = (key) => rows.reduce((o, r) => { o[r[key]] = (o[r[key]] || 0) + r.units; return o; }, {});
    const offline = rows.filter(r => r.reason !== 'online').reduce((a, r) => a + r.cents, 0);
    const posted = mrows.filter(m => !m.pickup);
    return {
      units: rows.reduce((a, r) => a + r.units, 0),
      cents: paidCents(mrows) + listCents(rows),       // what customers actually paid, all channels
      grams: rows.reduce((a, r) => a + r.units * gramsOf(r.sku), 0),
      bySku: by('sku'), byReason: by('reason'),
      money: {
        orders: mrows.length,
        online: paidCents(mrows),
        discounts: mrows.reduce((a, m) => a + m.discount_cents, 0),
        shippingIn: mrows.reduce((a, m) => a + m.shipping_cents, 0),
        refunds: mrows.reduce((a, m) => a + m.refunded_cents, 0),
        fees: mrows.reduce((a, m) => a + (m.fee_cents || 0), 0),
        feesPending: mrows.filter(m => m.fee_cents == null).length,
        postage: posted.reduce((a, m) => a + (m.postage_cents || 0), 0),
        postageMissing: posted.filter(m => m.postage_cents == null).length,
        postedOrders: posted.length,
        offline: offline + rows.filter(r => r.reason === 'online' && !moneyIds.has(r.ref)).reduce((a, r) => a + r.cents, 0)
      }
    };
  };

  // Weekly totals for the last 12 weeks (Mon–Sun, NZ time).
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const thisMonday = addDays(today, -dow);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = addDays(thisMonday, -7 * (11 - i));
    const end = addDays(start, 6);
    const rows = sales.filter(r => r.d >= start && r.d <= end);
    const mrows = money.filter(m => m.d >= start && m.d <= end);
    return { start, units: rows.reduce((a, r) => a + r.units, 0), cents: paidCents(mrows) + listCents(rows) };
  });

  // Selling pace over the last 28 days → how long stock lasts.
  const last28 = period(28);
  const gramsPerDay = last28.grams / 28;
  const pace = Object.fromEntries(products.map(p => {
    const perDay = (last28.bySku[p.sku] || 0) / 28;
    return [p.sku, { perDay: Math.round(perDay * 100) / 100, daysLeft: perDay > 0 ? Math.floor(Math.max(0, p.onHand) / perDay) : null }];
  }));

  // Yield from packed batches: grams of bagged biltong per kg raw.
  const packed = batches.filter(b => b.packedGrams > 0 && b.raw_kg > 0);
  const avgYield = packed.length
    ? packed.slice(0, 6).reduce((a, b) => a + b.packedGrams / b.raw_kg, 0) / Math.min(6, packed.length) : null;

  // When to start the next batch.
  const gramsOnHand = products.reduce((a, p) => a + Math.max(0, p.onHand) * p.grams, 0);
  const incoming = batches.filter(b => ['marinating', 'drying', 'ready'].includes(b.status))
    .reduce((a, b) => a + (avgYield ? b.raw_kg * avgYield : 0), 0);
  let forecast = null;
  if (gramsPerDay > 0) {
    const daysLeft = Math.floor((gramsOnHand + incoming) / gramsPerDay);
    const runOut = addDays(today, daysLeft);
    const startBy = addDays(runOut, -(settings.batchLeadDays || 6));
    forecast = { gramsPerDay: Math.round(gramsPerDay), daysLeft, runOut, startBy, overdue: startBy < today,
                 rawKgFor14Days: avgYield ? Math.round(gramsPerDay * 14 / avgYield * 10) / 10 : null };
  }

  // Cost per 100 g, averaged over recent batches with full costs.
  const costed = batches.filter(b => b.costPer100g != null).slice(0, 5);
  const costPer100g = costed.length ? Math.round(costed.reduce((a, b) => a + b.costPer100g, 0) / costed.length) : null;
  const margins = costPer100g == null ? null : BAG_SIZES.map(g => {
    const price = meta.SIZES[g], cost = Math.round(costPer100g * g / 100);
    return { grams: g, price, cost, profit: price - cost, pct: Math.round((price - cost) / price * 100) };
  });

  // Profit: what reached you, minus Stripe fees, postage and what the biltong cost to make.
  const withProfit = p => {
    const m = p.money;
    const productCost = costPer100g == null ? null
      : Object.entries(p.bySku).reduce((a, [sku, u]) => a + u * gramsOf(sku) * costPer100g / 100, 0);
    m.received = m.online - m.fees + m.offline;
    m.productCost = productCost == null ? null : Math.round(productCost);
    m.profit = productCost == null ? null : Math.round(m.received - m.postage - productCost);
    m.margin = m.profit != null && p.cents ? Math.round(m.profit / p.cents * 100) : null;
    m.avgOrder = m.orders ? Math.round(m.online / m.orders) : null;
    m.avgPostage = m.postedOrders - m.postageMissing > 0 ? Math.round(m.postage / (m.postedOrders - m.postageMissing)) : null;
    return p;
  };

  return {
    d7: withProfit(period(7)), d30: withProfit(period(30)), d90: withProfit(period(90)), weeks, pace, forecast,
    avgYield: avgYield ? Math.round(avgYield) : null, costPer100g, margins,
    stockValue: products.reduce((a, p) => a + Math.max(0, p.onHand) * p.price, 0)
  };
}

function buildAlerts({ today, products, batches, supplies, settings, numbers, safety }) {
  const out = [];
  for (const c of safety?.openCorrective || []) out.push({ level: 'bad', tab: 'safety', text: `Open corrective action: ${String(c.what || '').slice(0, 70)}` });
  for (const f of safety?.recentFails || []) {
    if (f.kind === 'corrective') continue;
    const b = batches.find(x => x.id === f.batch_id);
    out.push({ level: 'bad', tab: 'safety', text: `${b ? b.code + ': ' : ''}${f.fails[0] || 'A check failed'}` });
  }
  for (const b of batches) {
    const p = safety?.batches?.[b.id];
    if (b.status === 'packed' && p && !p.released && b.remainingBags > 0) out.push({ level: 'warn', tab: 'safety', text: `${b.code} is in stock but its batch record isn’t released yet.` });
  }
  if (!settings.live) out.push({ level: 'info', tab: 'stock', text: 'Shop isn’t using these numbers yet. Do a stocktake, then turn on live stock in Settings.' });
  // A whole flavour out gets one line, not one per bag size.
  const flavourOut = {};
  for (const p of products) flavourOut[p.flavour] = (flavourOut[p.flavour] ?? true) && (p.hidden || p.onHand <= 0);
  for (const [f, out_] of Object.entries(flavourOut)) {
    if (out_ && settings.live) out.push({ level: 'warn', tab: 'stock', text: `${meta.FLAVOURS[f]?.label || f} is sold out in every size.` });
  }
  for (const p of products) {
    if (p.hidden) continue;
    if (p.onHand < 0) out.push({ level: 'bad', tab: 'stock', text: `${p.label} shows ${p.onHand}. Do a stocktake to fix the count.` });
    else if (p.onHand === 0 && settings.live && !flavourOut[p.flavour]) out.push({ level: 'bad', tab: 'stock', text: `${p.label} is sold out on the shop.` });
    else if (p.onHand <= p.lowAt && !(flavourOut[p.flavour] && settings.live)) out.push({ level: 'warn', tab: 'stock', text: `${p.label}: ${p.onHand} left.` });
    for (const l of p.lots) {
      if (!l.bestBefore || l.qty <= 0) continue;
      const d = daysBetween(today, l.bestBefore);
      if (d < 0) out.push({ level: 'bad', tab: 'stock', text: `${l.qty} × ${p.label} from ${l.code} passed best-before (${l.bestBefore}).` });
      else if (d <= settings.bestBeforeWarnDays) out.push({ level: 'warn', tab: 'stock', text: `${l.qty} × ${p.label} from ${l.code} best-before in ${d} days.` });
    }
  }
  for (const s of supplies) {
    if (s.reorder_at != null && s.on_hand <= s.reorder_at) out.push({ level: 'warn', tab: 'supplies', text: `Reorder ${s.name}: ${fmt(s.on_hand)} ${s.unit} left.` });
  }
  for (const b of batches) {
    if (b.status === 'drying' && b.drying_on && daysBetween(b.drying_on, today) >= 4)
      out.push({ level: 'info', tab: 'batches', text: `${b.code} has been drying ${daysBetween(b.drying_on, today)} days. Check it and move it on.` });
    if (b.status === 'ready') out.push({ level: 'info', tab: 'batches', text: `${b.code} is ready to pack.` });
  }
  if (numbers.forecast?.overdue) out.push({ level: 'warn', tab: 'numbers', text: `At this pace you’ll run out around ${numbers.forecast.runOut}. Start a batch now.` });
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
const fmt = n => Number.isInteger(n) ? String(n) : n.toFixed(1);

/* ---------------------------------------------------------------- details */
async function batchDetail(id) {
  const { rows: [b] } = await q('SELECT * FROM batches WHERE id = $1', [id]);
  if (!b) return { error: 'Batch not found' };
  const { rows: moves } = await q(`SELECT * FROM movements WHERE batch_id = $1 ORDER BY at DESC, id DESC`, [id]);
  const { rows: used } = await q(`SELECT sm.*, s.name, s.unit FROM supply_moves sm JOIN supplies s ON s.id = sm.supply_id
                                   WHERE sm.batch_id = $1 ORDER BY sm.id`, [id]);
  return {
    batch: b, cost: await batchCost({ query: q }, id),
    moves: moves.map(m => ({ ...m, label: skuLabel(m.sku), reasonLabel: REASON_LABELS[m.reason] || m.reason })),
    used
  };
}

async function skuDetail(sku) {
  if (!CATALOGUE[sku]) return { error: 'Unknown product' };
  const { rows: moves } = await q(`SELECT m.*, b.code FROM movements m LEFT JOIN batches b ON b.id = m.batch_id
                                    WHERE m.sku = $1 ORDER BY m.at DESC, m.id DESC LIMIT 60`, [sku]);
  return { sku, moves: moves.map(m => ({ ...m, reasonLabel: REASON_LABELS[m.reason] || m.reason })) };
}

async function supplyDetail(id) {
  const { rows: moves } = await q(`SELECT sm.*, b.code FROM supply_moves sm LEFT JOIN batches b ON b.id = sm.batch_id
                                    WHERE sm.supply_id = $1 ORDER BY sm.at DESC, sm.id DESC LIMIT 40`, [id]);
  return { moves };
}

/* ========================================================================= POST */
const ACTIONS = {
  /* Bags in or out by hand. qty is always positive; direction comes from `dir`. */
  async adjust(c, b) {
    const sku = String(b.sku || ''); if (!CATALOGUE[sku]) fail('Pick a bag size');
    const qty = int(b.qty); if (!(qty > 0 && qty <= 1000)) fail('Enter how many bags');
    const note = clean(b.note);
    if (b.dir === 'in') {
      if (!IN_REASONS.includes(b.reason)) fail('Pick a reason');
      await addStock(c, { sku, qty, reason: b.reason, note, batchId: int(b.batchId) || null });
    } else {
      if (!OUT_REASONS.includes(b.reason)) fail('Pick a reason');
      let unit = null;
      if (['honesty', 'pickup'].includes(b.reason)) unit = priceOf(sku);
      if (b.reason === 'wholesale') unit = int(b.unitCents) ?? null;
      await takeStock(c, { sku, qty, reason: b.reason, note, unitCents: unit, batchId: int(b.batchId) || null });
    }
    return { msg: 'Saved' };
  },

  /* Count everything; differences are logged with one reason. */
  async stocktake(c, b) {
    const counts = b.counts || {};
    const reason = ['honesty', 'waste', 'staff', 'correction', 'sample'].includes(b.reason) ? b.reason : 'correction';
    const ref = 'stocktake-' + Date.now();
    const changes = [];
    for (const [sku, v] of Object.entries(counts)) {
      if (!CATALOGUE[sku] || v === '' || v == null) continue;
      const n = int(v); if (n == null || n < 0) fail(`Check the count for ${skuLabel(sku)}`);
      const diff = await countTo(c, { sku, counted: n, reasonIfShort: reason, ref });
      if (diff) changes.push(`${skuLabel(sku)} ${diff > 0 ? '+' : ''}${diff}`);
    }
    await setSettings(c, { lastStocktake: todayNZ() });
    return { msg: changes.length ? 'Counted: ' + changes.join(', ') : 'Counted. Everything matched.' };
  },

  /* Undo a manual change (not online orders — those come from Stripe). */
  async undo(c, b) {
    const { rows: [m] } = await c.query('SELECT * FROM movements WHERE id = $1', [int(b.id)]);
    if (!m) fail('Already gone');
    if (m.reason === 'online') fail('Online orders can’t be undone here');
    if (m.reason === 'packed') fail('Undo packing from the batch instead');
    if (m.ref?.startsWith('stocktake-')) await c.query('DELETE FROM movements WHERE ref = $1', [m.ref]);
    else await c.query('DELETE FROM movements WHERE id = $1', [m.id]);
    return { msg: 'Undone' };
  },

  async 'batch-start'(c, b) {
    const flavour = String(b.flavour || ''); if (!meta.FLAVOURS[flavour]) fail('Pick a flavour');
    const rawKg = num(b.rawKg); if (!(rawKg > 0 && rawKg < 200)) fail('Enter the raw weight in kg');
    const started = isDate(b.startedOn) ? b.startedOn : todayNZ();
    const meat = b.meatCost === '' || b.meatCost == null ? null : Math.round(num(b.meatCost) * 100);
    const code = await nextBatchCode(c);
    const { rows: [row] } = await c.query(
      `INSERT INTO batches (code, flavour, cut, raw_kg, meat_cost_cents, started_on, notes, marinate_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $6::date = $8::date THEN now() END) RETURNING id`,
      [code, flavour, clean(b.cut, 60), rawKg, meat, started, clean(b.notes, 1000), todayNZ()]);
    if (b.useSupplies !== false) await useSuppliesFor(c, { batchId: row.id, rawKg });
    return { msg: `${code} started`, id: row.id };
  },

  async 'batch-status'(c, b) {
    const id = int(b.id);
    const { rows: [bt] } = await c.query('SELECT * FROM batches WHERE id = $1', [id]); if (!bt) fail('Batch not found');
    const on = isDate(b.date) ? b.date : todayNZ();
    const to = String(b.status);
    const col = { drying: 'drying_on', ready: 'ready_on' }[to];
    if (col) await c.query(`UPDATE batches SET status = $2, ${col} = $3 WHERE id = $1`, [id, to, on]);
    // Tapping "Hung to dry" today records the exact time it went on.
    if (to === 'drying' && on === todayNZ()) await c.query(`UPDATE batches SET drying_at = now() WHERE id = $1`, [id]);
    else if (to === 'closed' || to === 'packed' || to === 'marinating' || to === 'drying') await c.query(`UPDATE batches SET status = $2 WHERE id = $1`, [id, to]);
    else fail('Unknown step');
    return { msg: `${bt.code}: ${to}` };
  },

  async 'batch-pack'(c, b) {
    const id = int(b.id);
    const { rows: [bt] } = await c.query('SELECT * FROM batches WHERE id = $1', [id]); if (!bt) fail('Batch not found');
    const bags = {};
    for (const g of BAG_SIZES) { const n = int(b.bags?.[g]) || 0; if (n < 0) fail('Bag counts can’t be negative'); if (n) bags[g] = n; }
    if (!Object.keys(bags).length) fail('Enter how many bags you packed');
    const packedOn = isDate(b.packedOn) ? b.packedOn : todayNZ();
    const s = await getSettings(c);
    const bestBefore = isDate(b.bestBefore) ? b.bestBefore : addMonths(packedOn, s.shelfLifeMonths || 3);
    for (const [g, n] of Object.entries(bags)) {
      await addStock(c, { sku: `${bt.flavour}-${g}`, qty: n, batchId: id, reason: 'packed', ref: 'pack-' + id });
    }
    if (b.useSupplies !== false) await useSuppliesFor(c, { batchId: id, bags });
    await c.query(`UPDATE batches SET status = 'packed', packed_on = $2, best_before = $3,
                   dried_kg = COALESCE($4, dried_kg), ready_on = COALESCE(ready_on, $2) WHERE id = $1`,
      [id, packedOn, bestBefore, num(b.driedKg)]);
    const total = Object.values(bags).reduce((a, n) => a + n, 0);
    return { msg: `${bt.code}: ${total} bags into stock` };
  },

  /* Take a packing back out (e.g. typed the wrong numbers). Only if none sold yet. */
  async 'batch-unpack'(c, b) {
    const id = int(b.id);
    const { rows: [x] } = await c.query(`SELECT COUNT(*)::int AS n FROM movements WHERE batch_id = $1 AND reason <> 'packed'`, [id]);
    if (x.n) fail('Some of this batch has already sold. Use a correction instead.');
    await c.query(`DELETE FROM movements WHERE batch_id = $1 AND reason = 'packed'`, [id]);
    const { rows: used } = await c.query(`SELECT supply_id, SUM(qty) AS qty FROM supply_moves WHERE batch_id = $1 AND reason = 'packed' GROUP BY 1`, [id]);
    for (const u of used) await c.query('UPDATE supplies SET on_hand = on_hand - $2 WHERE id = $1', [u.supply_id, u.qty]);
    await c.query(`DELETE FROM supply_moves WHERE batch_id = $1 AND reason = 'packed'`, [id]);
    await c.query(`UPDATE batches SET status = 'ready', packed_on = NULL, best_before = NULL WHERE id = $1`, [id]);
    return { msg: 'Packing undone' };
  },

  async 'batch-update'(c, b) {
    const id = int(b.id);
    const f = b.fields || {};
    const sets = [], vals = [id];
    const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('notes' in f) put('notes', clean(f.notes, 1000));
    if ('cut' in f) put('cut', clean(f.cut, 60));
    if ('meatCost' in f) put('meat_cost_cents', f.meatCost === '' || f.meatCost == null ? null : Math.round(num(f.meatCost) * 100));
    if ('driedKg' in f) put('dried_kg', num(f.driedKg));
    if ('rawKg' in f) { const r = num(f.rawKg); if (!(r > 0)) fail('Raw weight must be more than 0'); put('raw_kg', r); }
    if ('bestBefore' in f && isDate(f.bestBefore)) put('best_before', f.bestBefore);
    for (const [k, col] of [['marinateAt', 'marinate_at'], ['dryingAt', 'drying_at']]) {
      if (k in f) put(col, f[k] && !Number.isNaN(Date.parse(f[k])) ? new Date(f[k]) : null);
    }
    for (const [k, col] of [['startedOn', 'started_on'], ['dryingOn', 'drying_on'], ['readyOn', 'ready_on'], ['packedOn', 'packed_on']]) {
      if (k in f) put(col, isDate(f[k]) ? f[k] : null);
    }
    if (!sets.length) return { msg: 'Nothing changed' };
    await c.query(`UPDATE batches SET ${sets.join(', ')} WHERE id = $1`, vals);
    return { msg: 'Batch updated' };
  },

  async 'batch-delete'(c, b) {
    const id = int(b.id);
    const { rows: [x] } = await c.query(`SELECT COUNT(*)::int AS n FROM movements WHERE batch_id = $1`, [id]);
    if (x.n) fail('This batch has bags recorded. Undo the packing first.');
    const { rows: used } = await c.query(`SELECT supply_id, SUM(qty) AS qty FROM supply_moves WHERE batch_id = $1 GROUP BY 1`, [id]);
    for (const u of used) await c.query('UPDATE supplies SET on_hand = on_hand - $2 WHERE id = $1', [u.supply_id, u.qty]);
    await c.query(`DELETE FROM supply_moves WHERE batch_id = $1`, [id]);
    await c.query(`DELETE FROM batches WHERE id = $1`, [id]);
    return { msg: 'Batch deleted' };
  },

  async 'supply-move'(c, b) {
    const id = int(b.id);
    let qty = num(b.qty); if (!qty) fail('Enter an amount');
    const reason = ['received', 'used', 'correction', 'count'].includes(b.reason) ? b.reason : 'correction';
    if (reason === 'count') {
      const { rows: [s] } = await c.query('SELECT on_hand FROM supplies WHERE id = $1', [id]);
      qty = qty - s.on_hand;
      if (!qty) return { msg: 'Count matched' };
      await moveSupply(c, { id, qty, reason: 'correction', note: 'Counted' });
      return { msg: 'Count saved' };
    }
    if (reason === 'used') qty = -Math.abs(qty);
    if (reason === 'received') qty = Math.abs(qty);
    // Price can be given per unit, or as a total for the delivery.
    let cost = null;
    if (reason === 'received') {
      if (num(b.unitCost) != null) cost = num(b.unitCost) * 100;
      else if (num(b.totalCost) != null) cost = num(b.totalCost) * 100 / qty;
    }
    await moveSupply(c, { id, qty, reason, costCents: cost, note: clean(b.note) });
    return { msg: 'Saved' };
  },

  async 'supply-save'(c, b) {
    const name = clean(b.name, 80); if (!name) fail('Give it a name');
    const vals = [name, ['packaging', 'ingredient', 'other'].includes(b.category) ? b.category : 'other',
      clean(b.unit, 20) || 'each', num(b.reorderAt), num(b.reorderQty),
      num(b.unitCost) == null ? null : num(b.unitCost) * 100, clean(b.supplier, 120),
      ['bag-50', 'bag-100', 'bag-200', 'bag-100+', 'bag-any', 'raw-kg'].includes(b.autoUse) ? b.autoUse : null,
      num(b.usePer) ?? 1];
    if (b.id) {
      await c.query(`UPDATE supplies SET name=$2, category=$3, unit=$4, reorder_at=$5, reorder_qty=$6, cost_cents=$7,
                       supplier=$8, auto_use=$9, use_per=$10 WHERE id=$1`, [int(b.id), ...vals]);
      return { msg: 'Saved' };
    }
    await c.query(`INSERT INTO supplies (name, category, unit, reorder_at, reorder_qty, cost_cents, supplier, auto_use, use_per)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, vals);
    return { msg: 'Added' };
  },

  async 'supply-archive'(c, b) {
    await c.query('UPDATE supplies SET archived = true WHERE id = $1', [int(b.id)]);
    return { msg: 'Removed' };
  },

  async 'product-save'(c, b) {
    if (!CATALOGUE[b.sku]) fail('Unknown product');
    const low = int(b.lowAt); if (low == null || low < 0) fail('Low level must be 0 or more');
    await c.query('UPDATE products SET low_at = $2, hidden = $3 WHERE sku = $1', [b.sku, low, Boolean(b.hidden)]);
    return { msg: 'Saved' };
  },

  async 'settings-save'(c, b) {
    const patch = {};
    if ('live' in b) {
      patch.live = Boolean(b.live);
      const was = await getSettings(c);
      if (patch.live && !was.live) patch.liveSince = new Date().toISOString();
    }
    if ('emailAlerts' in b) patch.emailAlerts = Boolean(b.emailAlerts);
    for (const k of ['showLeftUnder', 'shelfLifeMonths', 'bestBeforeWarnDays', 'batchLeadDays']) {
      if (k in b) { const n = int(b[k]); if (n == null || n < 0 || n > 365) fail('Check the numbers'); patch[k] = n; }
    }
    await setSettings(c, patch);
    return { msg: 'Settings saved' };
  },

  /* ---- food safety records ---- */
  async 'fs-save'(c, b) {
    const r = await saveRecord(c, b, fail);
    const msg = r.pass === false ? 'Saved. A limit wasn’t met.' : r.pass === null && r.missing?.length ? 'Saved. Some parts still to do.' : 'Saved';
    return { msg, record: r };
  },
  async 'fs-void'(c, b) { return voidRecord(c, b, fail); },
  async 'fs-skip'(c, b) { return skipReminder(c, b, fail); },
  async 'fs-settings'(c, b) { return saveFsSettings(c, b, fail); },

  async 'waitlist-remove'(c, b) {
    await c.query('DELETE FROM waitlist WHERE id = $1', [int(b.id)]);
    return { msg: 'Removed' };
  }
};

/* Sending emails shouldn't sit inside a database transaction. */
async function waitlistList() {
  const { rows } = await q(`SELECT * FROM waitlist ORDER BY notified_at NULLS FIRST, created_at DESC LIMIT 300`);
  return { rows };
}

/**
 * Safety net for the webhook: look at recent paid Stripe orders and record any
 * the stock doesn't know about yet. Runs each time the dashboard opens.
 */
async function syncOrders() {
  const s = await getSettings();
  if (!process.env.STRIPE_SECRET_KEY) return { added: 0 };
  const money = await syncFinance(await stripeClient()).catch(err => { console.error('Money sync failed:', err.message); return null; });
  if (!s.live || !s.liveSince) return { added: 0, money };
  const since = Math.max(Math.floor(new Date(s.liveSince).getTime() / 1000), Math.floor(Date.now() / 1000) - 14 * 86400);
  const stripe = await stripeClient();
  const list = await stripe.checkout.sessions.list({ limit: 100, created: { gte: since } });
  const paid = list.data.filter(x => x.payment_status === 'paid');
  if (!paid.length) return { added: 0, money };
  const { rows } = await q('SELECT session_id FROM processed_orders WHERE session_id = ANY($1)', [paid.map(x => x.id)]);
  const known = new Set(rows.map(r => r.session_id));
  let added = 0;
  for (const sess of paid.filter(x => !known.has(x.id))) {
    const r = await recordOrder(sess);
    if (r.recorded) added++;
  }
  return { added, money };
}

async function waitlistSend(b) {
  const flavour = String(b.flavour || '');
  const label = meta.FLAVOURS[flavour]?.label; if (!label) fail('Pick a flavour');
  if (!mailReady()) fail('Email settings missing in Vercel');
  const { rows } = await q(`SELECT id, email FROM waitlist WHERE flavour = $1 AND notified_at IS NULL LIMIT 90`, [flavour]);
  if (!rows.length) fail('Nobody waiting for that one');
  const site = (process.env.SITE_URL || 'https://blairsbiltong.co.nz').replace(/\/+$/, '');
  let sent = 0;
  for (const r of rows) {
    const html = wrapEmail(`${label} is back`, [
      `<p style="margin:0 0 14px;line-height:1.55">You asked us to let you know. A fresh batch of ${esc(label)} is bagged and ready to go.</p>`,
      `<p style="margin:0 0 18px;line-height:1.55">Small batches go fast, so don't wait too long.</p>`,
      `<p style="margin:0"><a href="${site}/#shop" style="display:inline-block;background:#b9873c;color:#150e07;text-decoration:none;font-weight:bold;letter-spacing:2px;text-transform:uppercase;font-size:13px;padding:13px 20px;border-radius:5px">Shop now</a></p>`
    ], 'You’re getting this because you asked to be told when this flavour was back. It’s a one-off email.');
    const res = await sendMail({ to: r.email, subject: `${label} is back in stock`, html,
      text: `${label} is back in stock. Small batches go fast: ${site}/#shop` });
    if (res.ok) { sent++; await q('UPDATE waitlist SET notified_at = now() WHERE id = $1', [r.id]); }
  }
  return { msg: `Emailed ${sent} of ${rows.length}` };
}

export async function POST(request) {
  if (!authorised(request)) return json({ error: 'Wrong password' }, 401);
  if (!hasDb()) return json({ error: 'no_db' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  try {
    if (body.action === 'waitlist-send') return json(await waitlistSend(body));
    if (body.action === 'waitlist-list') return json(await waitlistList());
    if (body.action === 'sync-orders') return json(await syncOrders());
    if (body.action === 'postage-set') {
      const cents = postageCents(body.postage);
      if (cents === undefined) fail('Check the postage amount');
      if (!String(body.sessionId || '').startsWith('cs_')) fail('Missing order');
      await savePostage(await stripeClient(), String(body.sessionId), cents ?? null);
      if (cents == null) await q('UPDATE order_finance SET postage_cents = NULL WHERE session_id = $1', [body.sessionId]);
      return json({ ok: true, msg: cents == null ? 'Postage cleared' : 'Postage saved' });
    }
    if (body.action === 'fs-print-link' || body.action === 'fs-export-link') {
      const from = isDate(body.from) ? body.from : addDays(todayNZ(), -30), to = isDate(body.to) ? body.to : todayNZ();
      const site = (process.env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
      const param = body.action === 'fs-print-link' ? 'print' : 'export';
      return json({ url: `${site}/api/boss?${param}=${encodeURIComponent(printToken(from, to))}` });
    }
    if (body.action === 'test-alert') {
      const r = await sendMail({ subject: 'Test alert from your dashboard', html: wrapEmail('Alerts are working', ['<p>Low-stock and reorder alerts will arrive like this.</p>']), text: 'Alerts are working.' });
      if (!r.ok) fail(r.error);
      return json({ msg: 'Test email sent' });
    }
    const fn = ACTIONS[body.action];
    if (!fn) return json({ error: 'Unknown action' }, 400);
    const out = await tx(c => fn(c, body));
    await checkAlerts().catch(err => console.error('Alert check failed:', err.message));
    return json({ ok: true, ...out });
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error('boss POST failed:', err);
    return json({ error: 'Something went wrong saving that. ' + (err.message || '') }, 500);
  }
}
