/**
 * Tests for the checkout payload builder. No Stripe account or network needed.
 * Run with:  npm run test:checkout
 */
import assert from 'node:assert';
import { buildSessionPayload, CATALOGUE } from '../api/create-checkout-session.js';

const SITE = 'https://blairsbiltong.co.nz';
let passed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

const shippingOf = p => p.shipping_options[0].shipping_rate_data.fixed_amount.amount;
const subtotalOf = p => p.line_items.reduce(
  (t, li) => t + li.price_data.unit_amount * li.quantity, 0);

console.log('\nCheckout payload');

test('single pack charges flat shipping', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE);
  assert.strictEqual(subtotalOf(p), 750);
  assert.strictEqual(shippingOf(p), 500);
  assert.strictEqual(p.line_items.length, 1);
});

test('six packs still under the free-shipping threshold', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 6 }], SITE);
  assert.strictEqual(subtotalOf(p), 4500);
  assert.strictEqual(shippingOf(p), 500);
});

test('seven packs unlocks free shipping', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 7 }], SITE);
  assert.strictEqual(subtotalOf(p), 5250);
  assert.strictEqual(shippingOf(p), 0);
  assert.strictEqual(p.shipping_options[0].shipping_rate_data.display_name, 'Free shipping');
});

test('mixed cart totals correctly', () => {
  const p = buildSessionPayload(
    [{ id: 'original', qty: 2 }, { id: 'dryheat', qty: 3 }], SITE);
  assert.strictEqual(subtotalOf(p), 3750);
  assert.strictEqual(shippingOf(p), 500);
  assert.strictEqual(p.line_items.length, 2);
});

console.log('\nLocal pickup');

test('pickup code skips the delivery address entirely', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE, 'LOCAL');
  assert.strictEqual(p.shipping_address_collection, undefined);
  assert.strictEqual(p.shipping_options, undefined);
});

test('pickup code still collects a phone number', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE, 'LOCAL');
  assert.strictEqual(p.phone_number_collection.enabled, true);
});

test('pickup order is tagged do-not-post', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE, 'LOCAL');
  assert.ok(p.metadata.fulfilment.startsWith('LOCAL PICKUP'));
  assert.strictEqual(p.metadata.local_code, 'LOCAL');
});

test('pickup success url carries the pickup flag', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE, 'LOCAL');
  assert.ok(p.success_url.includes('pickup=1'));
});

test('delivery orders are unaffected by the pickup path', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE);
  assert.deepStrictEqual(p.shipping_address_collection, { allowed_countries: ['NZ'] });
  assert.strictEqual(p.metadata.fulfilment, 'Post');
  assert.ok(!p.success_url.includes('pickup=1'));
});

test('an unrecognised code is treated as a normal delivery', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE, 'NOTACODE');
  assert.deepStrictEqual(p.shipping_address_collection, { allowed_countries: ['NZ'] });
  assert.strictEqual(shippingOf(p), 500);
});

test('duplicate lines are merged, not doubled up', () => {
  const p = buildSessionPayload(
    [{ id: 'dryheat', qty: 1 }, { id: 'dryheat', qty: 2 }], SITE);
  assert.strictEqual(p.line_items.length, 1);
  assert.strictEqual(p.line_items[0].quantity, 3);
});

test('quantity is capped at 20', () => {
  const p = buildSessionPayload([{ id: 'dryheat', qty: 999 }], SITE);
  assert.strictEqual(p.line_items[0].quantity, 20);
});

console.log('\nPrices come from the server, not the browser');

test('a price sent by the client is ignored', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1, price: 0.01 }], SITE);
  assert.strictEqual(p.line_items[0].price_data.unit_amount, CATALOGUE.original.cents);
});

console.log('\nBad input is rejected');

const rejects = [
  ['empty cart',        []],
  ['not an array',      null],
  ['unknown product',   [{ id: 'wagyu', qty: 1 }]],
  ['zero quantity',     [{ id: 'original', qty: 0 }]],
  ['negative quantity', [{ id: 'original', qty: -5 }]],
  ['non-numeric qty',   [{ id: 'original', qty: 'lots' }]],
  ['prototype key',     [{ id: 'constructor', qty: 1 }]],
  ['too many lines',    Array.from({ length: 11 }, () => ({ id: 'original', qty: 1 }))]
];

for (const [name, cart] of rejects) {
  test(`rejects ${name}`, () => {
    assert.throws(() => buildSessionPayload(cart, SITE));
  });
}

console.log('\nURLs and shipping config');

test('success url carries the session placeholder', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE);
  assert.strictEqual(p.success_url, `${SITE}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  assert.strictEqual(p.cancel_url, `${SITE}/#shop`);
});

test('ships to New Zealand only', () => {
  const p = buildSessionPayload([{ id: 'original', qty: 1 }], SITE);
  assert.deepStrictEqual(p.shipping_address_collection.allowed_countries, ['NZ']);
  assert.strictEqual(p.phone_number_collection.enabled, true);
  assert.strictEqual(p.allow_promotion_codes, true);
});

test('pack list metadata is readable', () => {
  const p = buildSessionPayload(
    [{ id: 'original', qty: 2 }, { id: 'dryheat', qty: 1 }], SITE);
  assert.strictEqual(p.metadata.pack_list, '2x original, 1x dryheat');
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
