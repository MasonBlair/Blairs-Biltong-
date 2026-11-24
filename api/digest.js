/**
 * Weekly summary email — Vercel Cron
 * ----------------------------------------------------------------------------
 * Runs every Sunday at about 5:30 pm NZ time (see "crons" in vercel.json), in
 * time for Sunday planning. Emails ORDER_EMAIL_TO: last week's sales, what's
 * low, what to make next.
 *
 * Vercel sends CRON_SECRET with the request, so nobody else can trigger it.
 * Set CRON_SECRET in Vercel (any long random text) to switch it on.
 */
import { hasDb } from './_lib/db.js';
import { overview } from './boss.js';
import { sendMail, wrapEmail, esc, mailReady } from './_lib/mail.js';

const money = c => '$' + (c / 100).toFixed(2);
const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorised', { status: 401 });
  if (!hasDb() || !mailReady()) return new Response('Not set up', { status: 200 });

  const o = await overview();
  const n = o.numbers;
  const row = (a, b) => `<tr><td style="padding:6px 0;color:#6b5b49">${esc(a)}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${esc(b)}</td></tr>`;
  const stockRows = o.products.filter(p => !p.hidden).map(p => row(p.label, `${p.onHand} bag${p.onHand === 1 ? '' : 's'}`)).join('');
  const blocks = [
    `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 18px">
      ${row('Sales this past week', money(n.d7.cents))}
      ${row('Bags sold', String(n.d7.units))}
      ${row('Last 30 days', money(n.d30.cents))}
     </table>`,
    `<h2 style="font-size:15px;margin:0 0 6px">In stock</h2><table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 18px">${stockRows}</table>`
  ];
  if (n.forecast) blocks.push(`<p style="margin:0 0 18px;line-height:1.5"><strong>Next batch:</strong> start by ${esc(nice(n.forecast.startBy))}${n.forecast.overdue ? ' (that’s now)' : ''}. At this pace stock runs out around ${esc(nice(n.forecast.runOut))}.${n.forecast.rawKgFor14Days ? ` About ${n.forecast.rawKgFor14Days} kg raw covers two weeks.` : ''}</p>`);
  const todo = o.alerts.filter(a => a.level !== 'info');
  if (todo.length) blocks.push(`<h2 style="font-size:15px;margin:0 0 6px">Needs attention</h2><ul style="margin:0 0 12px;padding-left:18px">${todo.map(a => `<li style="margin:4px 0">${esc(a.text)}</li>`).join('')}</ul>`);

  await sendMail({ subject: `Your week: ${money(n.d7.cents)} from ${n.d7.units} bags`, html: wrapEmail('Weekly summary', blocks),
    text: `Sales this week ${money(n.d7.cents)} (${n.d7.units} bags).` });
  return new Response('sent', { status: 200 });
}
