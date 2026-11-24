/**
 * Public stock info for the shop — Vercel Function
 * ----------------------------------------------------------------------------
 * GET  /api/stock   → { live, items: { "original-100": { available, left } } }
 *                     `left` is only filled in when it's low ("Only 3 left").
 * POST /api/stock   { email, flavour } → join the "tell me when it's back" list
 *
 * With no database connected this answers { live: false } and the shop falls
 * back to the sold-out flags written in index.html.
 */
import { hasDb, availability } from './_lib/stock.js';
import { q } from './_lib/db.js';
import { FLAVOURS } from './_lib/catalogue.js';

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

export async function GET() {
  if (!hasDb()) return json({ live: false, items: {} });
  try {
    // Short CDN cache: quick for shoppers, still current within ~20 seconds.
    return json(await availability(), 200, 'public, s-maxage=20, stale-while-revalidate=60');
  } catch (err) {
    console.error('stock GET failed:', err.message);
    return json({ live: false, items: {} });
  }
}

const looksLikeEmail = s => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export async function POST(request) {
  let email, flavour;
  try {
    const b = await request.json();
    email = String(b.email || '').trim().toLowerCase();
    flavour = String(b.flavour || '');
  } catch { return json({ error: 'Bad request' }, 400); }
  if (!looksLikeEmail(email)) return json({ error: 'That doesn’t look like an email address.' }, 400);
  if (!FLAVOURS[flavour]) return json({ error: 'Unknown flavour' }, 400);
  if (!hasDb()) {
    console.log(`WAITLIST  ${email}  ${flavour}  ${new Date().toISOString()}`);
    return json({ ok: true });
  }
  try {
    await q(`INSERT INTO waitlist (email, flavour) VALUES ($1,$2)
             ON CONFLICT (email, flavour) DO UPDATE SET notified_at = NULL, created_at = now()`, [email, flavour]);
    return json({ ok: true });
  } catch (err) {
    console.error('waitlist failed:', err.message);
    return json({ error: 'Couldn’t save that just now. Try again shortly.' }, 500);
  }
}
