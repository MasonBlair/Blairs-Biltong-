/**
 * Plain helper for emails the dashboard sends to you (alerts, weekly summary)
 * and the "it's back" email to people on the waitlist. Uses the same Resend
 * settings as the shipped email.
 */
export const mailReady = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && process.env.ORDER_EMAIL_TO);

export async function sendMail({ to, subject, html, text }) {
  const { RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_EMAIL_TO } = process.env;
  if (!mailReady()) return { ok: false, error: 'Email settings missing in Vercel' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ORDER_EMAIL_FROM, to: [to || ORDER_EMAIL_TO], reply_to: ORDER_EMAIL_TO, subject, html, text
    })
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error('Resend failed:', res.status, detail);
    return { ok: false, error: `Email didn’t send (${res.status})` };
  }
  return { ok: true };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Simple branded wrapper: dark header bar, cream body. `blocks` are HTML strings. */
export function wrapEmail(title, blocks, footer = '') {
  return `<!doctype html><html><body style="margin:0;background:#efe4d0;font-family:Helvetica,Arial,sans-serif;color:#241b13">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe4d0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f7f1e4;border-radius:8px;overflow:hidden">
<tr><td style="background:#241b13;border-bottom:4px solid #b9873c;padding:18px 24px;color:#f7f1e4;font-size:13px;letter-spacing:3px;text-transform:uppercase;font-weight:bold">Blair's Biltong</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(title)}</h1>
${blocks.join('\n')}
</td></tr>
${footer ? `<tr><td style="padding:0 24px 22px;font-size:12px;color:#6b5b49">${footer}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}
export { esc };
