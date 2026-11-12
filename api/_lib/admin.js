/**
 * Shared helpers for the private dispatch endpoints (api/orders, api/mark-shipped).
 * Not an endpoint itself — Vercel skips files under "_" folders.
 */
import { timingSafeEqual } from 'node:crypto';

export const STRIPE_API_VERSION = '2025-10-29.clover';

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

/** True when the request carries the DISPATCH_PASSWORD set in Vercel. */
export function authorised(request) {
  const expected = process.env.DISPATCH_PASSWORD || '';
  const given = request.headers.get('x-dispatch-key') || '';
  if (!expected || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function stripeClient() {
  const { default: Stripe } = await import('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

/** Newer Stripe API versions moved shipping_details; read either place. */
export function shippingOf(session) {
  return session.shipping_details || session.collected_information?.shipping_details || null;
}

export function isPickup(session) {
  return String(session?.metadata?.fulfilment || '').startsWith('LOCAL PICKUP');
}
