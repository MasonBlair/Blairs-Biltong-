/**
 * Local pickup codes
 * ----------------------------------------------------------------------------
 * For people who buy from you face to face. They order through the website so
 * you get the sale recorded properly, but they pay no freight because you're
 * handing it over.
 *
 * These are deliberately NOT Stripe coupons. A Stripe coupon discounts the
 * product subtotal, not the shipping line — so it can't actually make freight
 * free, and it would also hand $5 off to anyone already over the free-shipping
 * threshold. This does the right thing instead: it swaps the shipping option
 * for a $0 "Local pickup" one.
 *
 * TO CHANGE THE CODES without editing this file, set an environment variable in
 * Vercel (comma-separated, case doesn't matter):
 *
 *   LOCAL_PICKUP_CODES = LOCAL,GYMCREW,QTOWN
 *
 * If that variable isn't set, the defaults below are used.
 */

const DEFAULT_CODES = ['LOCAL'];

export function validCodes() {
  const fromEnv = (process.env.LOCAL_PICKUP_CODES || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_CODES;
}

/** Returns the matched code in canonical form, or null. */
export function checkCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 40) return null;
  return validCodes().includes(code) ? code : null;
}
