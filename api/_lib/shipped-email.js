/**
 * "Your order is on its way" email — branded HTML + plain-text fallback.
 * ----------------------------------------------------------------------------
 * Pure function: give it the Stripe Checkout Session, its line items and the
 * NZ Post tracking number, get back { subject, html, text } ready for Resend.
 *
 * Email clients are fussy, so this is deliberately old-school: tables, inline
 * styles, no external CSS. Oswald loads in Apple Mail / iOS; Gmail and Outlook
 * fall back to Arial Narrow / Arial, which still looks right.
 *
 * Files under api/_lib are not deployed as endpoints (Vercel skips "_" paths).
 */

const SITE = 'https://blairsbiltong.co.nz';
const LOGO = `${SITE}/assets/blairs-logo.png`;
const TRACK_URL = n => `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(n)}`;

const C = {
  ink: '#241b13', ink2: '#150e07', cream: '#efe4d0', cream2: '#f7f1e4',
  cream3: '#e2d5bd', gold: '#b9873c', kraft: '#c9a878', muted: '#6b5b49'
};
const HEAD = `'Oswald','Arial Narrow',Arial,sans-serif`;
const BODY = `'Barlow',Helvetica,Arial,sans-serif`;

const money = cents => '$' + ((cents || 0) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function firstName(session) {
  const full = session.customer_details?.name || session.shipping_details?.name || '';
  const first = full.trim().split(/\s+/)[0] || '';
  // "JOHN" or "john" → "John"; leave "McKenzie"-style names alone.
  return first && (first === first.toUpperCase() || first === first.toLowerCase())
    ? first[0].toUpperCase() + first.slice(1).toLowerCase()
    : first;
}

function addressLines(session) {
  const d = session.shipping_details || session.collected_information?.shipping_details || {};
  const a = d.address || {};
  return [d.name, a.line1, a.line2, [a.city, a.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean);
}

/**
 * @param {object} session    Stripe Checkout Session (paid)
 * @param {Array}  lineItems  session line items: { description, quantity, amount_total }
 * @param {object} opts       { tracking: 'NZ Post tracking number', note?: 'optional personal line' }
 */
export function buildShippedEmail(session, lineItems, { tracking, note } = {}) {
  const name = firstName(session);
  const greeting = name ? `Kia ora ${name},` : 'Kia ora,';
  const orderRef = session.id.slice(-8).toUpperCase();
  const addr = addressLines(session);
  const shipping = session.total_details?.amount_shipping || 0;
  const discount = session.total_details?.amount_discount || 0;
  const trackUrl = tracking ? TRACK_URL(tracking) : null;

  const subject = `Your Blair's Biltong is on its way`;
  const preheader = tracking
    ? `Packed by hand in Queenstown and with NZ Post now. Tracking: ${tracking}`
    : `Packed by hand in Queenstown and with NZ Post now.`;

  // ---------- plain text ----------
  const text = [
    greeting,
    '',
    `Your order's packed and on its way. Every bag was cut, marinated and air dried by hand in Queenstown, and I packed this one myself.`,
    note ? `\n${note}` : null,
    '',
    tracking ? `NZ Post tracking: ${tracking}\nTrack it: ${trackUrl}` : 'Sent with NZ Post.',
    'Usually arrives in 2–5 working days.',
    '',
    `ORDER #${orderRef}`,
    ...lineItems.map(li => `  ${li.quantity} × ${li.description}   ${money(li.amount_total)}`),
    `  Shipping   ${shipping ? money(shipping) : 'Free'}`,
    discount ? `  Discount   −${money(discount)}` : null,
    `  Total      ${money(session.amount_total)}`,
    '',
    addr.length ? `Delivering to:\n  ${addr.join('\n  ')}` : null,
    '',
    `Once it lands, keep it somewhere cool and dry. Storage and best-before details are on the back of the pack.`,
    '',
    `If anything's not right, or you just want to tell me what you thought, hit reply. It comes straight to me.`,
    '',
    'Cheers,',
    'Mason',
    "Blair's Biltong · Queenstown, New Zealand",
    SITE
  ].filter(l => l !== null).join('\n');

  // ---------- HTML ----------
  const itemRows = lineItems.map(li => `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${C.cream3};font:500 15px/1.4 ${BODY};color:${C.ink}">
              ${esc(li.description)} <span style="color:${C.muted}">× ${li.quantity}</span></td>
            <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.cream3};font:500 15px/1.4 ${BODY};color:${C.ink};white-space:nowrap">
              ${money(li.amount_total)}</td>
          </tr>`).join('');

  const totalRow = (label, value, strong) => `
          <tr>
            <td style="padding:${strong ? '12px' : '6px'} 0 0;font:${strong ? '600 13px' : '500 14px'}/1.4 ${strong ? HEAD : BODY};${strong ? 'letter-spacing:.12em;text-transform:uppercase;' : ''}color:${strong ? C.ink : C.muted}">${label}</td>
            <td align="right" style="padding:${strong ? '12px' : '6px'} 0 0;font:${strong ? '600 18px' : '500 14px'}/1.4 ${strong ? HEAD : BODY};color:${strong ? C.ink : C.muted}">${value}</td>
          </tr>`;

  const trackingBlock = tracking ? `
      <tr><td class="px" style="padding:0 36px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ink};border-radius:6px">
          <tr><td style="padding:22px 24px 6px;font:600 12px/1 ${HEAD};letter-spacing:.18em;text-transform:uppercase;color:${C.kraft}">
            NZ Post tracking number</td></tr>
          <tr><td style="padding:4px 24px 18px;font:600 22px/1.3 ${HEAD};letter-spacing:.06em;color:${C.cream2}">
            ${esc(tracking)}</td></tr>
          <tr><td style="padding:0 24px 24px">
            <a href="${trackUrl}" style="display:inline-block;background:${C.gold};color:${C.ink2};font:600 14px/1 ${HEAD};letter-spacing:.14em;text-transform:uppercase;text-decoration:none;padding:15px 26px;border-radius:4px">
              Track your parcel</a></td></tr>
        </table>
      </td></tr>` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Barlow:wght@400;500;600&family=Caveat:wght@600&display=swap" rel="stylesheet">
<style>
  @media (max-width:520px){ .px{padding-left:22px!important;padding-right:22px!important} .h1{font-size:30px!important} }
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream3}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream3}">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:${C.cream2};border-radius:8px;overflow:hidden">

    <!-- header -->
    <tr><td align="center" style="background:${C.ink};padding:30px 24px 26px;border-bottom:4px solid ${C.gold}">
      <img src="${LOGO}" width="120" alt="Blair's Biltong" style="display:block;width:120px;height:auto;border:0">
      <div style="padding-top:14px;font:500 12px/1 ${HEAD};letter-spacing:.32em;text-transform:uppercase;color:${C.kraft}">
        Air dried · Mountain made</div>
    </td></tr>

    <!-- headline -->
    <tr><td class="px" style="padding:38px 36px 6px">
      <div style="font:600 12px/1 ${HEAD};letter-spacing:.2em;text-transform:uppercase;color:${C.gold}">Order #${orderRef} · Shipped</div>
      <h1 class="h1" style="margin:12px 0 0;font:600 36px/1.1 ${HEAD};text-transform:uppercase;color:${C.ink}">It's on its way</h1>
    </td></tr>

    <!-- personal note -->
    <tr><td class="px" style="padding:18px 36px 26px;font:400 16px/1.6 ${BODY};color:${C.ink}">
      <p style="margin:0 0 14px">${esc(greeting)}</p>
      <p style="margin:0 0 14px">Your order's packed and on its way. Every bag was cut, marinated and air dried by hand in Queenstown, and I packed this one myself.</p>
      ${note ? `<p style="margin:0 0 14px">${esc(note)}</p>` : ''}
      <p style="margin:0">It's with NZ Post now and usually arrives in <strong>2–5 working days</strong>.</p>
    </td></tr>

    ${trackingBlock}

    <!-- order summary -->
    <tr><td class="px" style="padding:26px 36px 8px">
      <div style="font:600 13px/1 ${HEAD};letter-spacing:.18em;text-transform:uppercase;color:${C.ink};padding-bottom:6px;border-bottom:2px solid ${C.ink}">What's in the box</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${itemRows}
        ${totalRow('Shipping', shipping ? money(shipping) : 'Free')}
        ${discount ? totalRow('Discount', '−' + money(discount)) : ''}
        ${totalRow('Total paid', money(session.amount_total), true)}
      </table>
    </td></tr>

    ${addr.length ? `
    <!-- address -->
    <tr><td class="px" style="padding:22px 36px 4px">
      <div style="font:600 13px/1 ${HEAD};letter-spacing:.18em;text-transform:uppercase;color:${C.ink};padding-bottom:8px">Delivering to</div>
      <div style="font:400 15px/1.55 ${BODY};color:${C.muted}">${addr.map(esc).join('<br>')}</div>
    </td></tr>` : ''}

    <!-- care + sign-off -->
    <tr><td class="px" style="padding:26px 36px 34px;font:400 16px/1.6 ${BODY};color:${C.ink}">
      <p style="margin:0 0 14px;padding:14px 16px;background:${C.cream};border-left:3px solid ${C.gold};font-size:14px;color:${C.muted}">
        Once it lands, keep it somewhere cool and dry. Storage and best-before details are on the back of the pack.</p>
      <p style="margin:0 0 18px">If anything's not right, or you just want to tell me what you thought, hit reply. It comes straight to me.</p>
      <p style="margin:0">Cheers,</p>
      <p style="margin:2px 0 0;font:600 22px/1.2 'Caveat','Segoe Script','Brush Script MT',cursive;color:${C.ink}">Mason</p>
      <p style="margin:2px 0 0;font-size:14px;color:${C.muted}">Founder, Blair's Biltong</p>
    </td></tr>

    <!-- footer -->
    <tr><td align="center" style="background:${C.ink};padding:22px 24px;font:400 13px/1.6 ${BODY};color:${C.kraft}">
      Blair's Biltong · Queenstown, New Zealand<br>
      <a href="${SITE}" style="color:${C.cream};text-decoration:none">blairsbiltong.co.nz</a>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
