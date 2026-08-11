/**
 * Email signup — Vercel Function
 * ----------------------------------------------------------------------------
 * The site had two signup forms wired to Netlify Forms. Vercel has no
 * equivalent built in, so this takes their place.
 *
 * As shipped it validates the address and writes it to the Vercel function log
 * (Project → Logs). That is fine for a handful of pre-launch signups, but it is
 * NOT a mailing list — logs are retained for a limited window and you can't
 * export them nicely.
 *
 * TO MAKE IT A REAL LIST, pick one and set the env vars in Vercel:
 *
 *   a) Email them to yourself — simplest. Sign up at resend.com (free), set:
 *        RESEND_API_KEY   = re_...
 *        ORDER_EMAIL_TO   = you@blairsbiltong.co.nz
 *        ORDER_EMAIL_FROM = hello@blairsbiltong.co.nz   (verified domain)
 *
 *   b) Straight into a mailing list tool — Buttondown, Mailchimp, ConvertKit
 *      all have a simple API. Worth doing before launch if you plan to email
 *      customers, because re-importing addresses later is a chore.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

// Deliberately permissive — the point is to catch typos, not to police RFC 5322.
const looksLikeEmail = s =>
  typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export async function POST(request) {
  let email, source;
  try {
    const body = await request.json();
    email = String(body.email || '').trim().toLowerCase();
    source = String(body.source || 'unknown').slice(0, 40);
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  if (!looksLikeEmail(email)) {
    return json({ error: 'That doesn’t look like an email address.' }, 400);
  }

  console.log(`SIGNUP  ${email}  (${source})  ${new Date().toISOString()}`);

  const { RESEND_API_KEY: key, ORDER_EMAIL_TO: to, ORDER_EMAIL_FROM: from } = process.env;
  if (key && to && from) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [to],
          subject: `New signup — ${email}`,
          text: `${email}\nForm: ${source}\n${new Date().toISOString()}`
        })
      });
      if (!res.ok) console.error('Resend failed:', res.status, await res.text());
    } catch (err) {
      // Never fail the signup because the notification didn't send.
      console.error('Notify failed:', err && err.message);
    }
  }

  return json({ ok: true });
}
