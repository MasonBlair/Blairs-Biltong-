/**
 * Validate a local pickup code — Vercel Function
 * ----------------------------------------------------------------------------
 * The cart calls this so it can show "Local pickup — Free" before the customer
 * reaches Stripe. The codes live on the server only, so they aren't sitting in
 * the page source for anyone to read.
 *
 * The real decision is still made in create-checkout-session.js — this endpoint
 * only affects what the cart displays. Faking a response here gets you nothing.
 */

import { checkCode } from './local-codes.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

export async function POST(request) {
  let code;
  try {
    ({ code } = await request.json());
  } catch {
    return json({ valid: false }, 400);
  }

  const matched = checkCode(code);
  return json(matched
    ? { valid: true,  code: matched, label: 'Local pickup' }
    : { valid: false, message: 'That code isn’t recognised.' });
}

export async function GET() {
  return json({ error: 'Method not allowed' }, 405);
}
