# Wiring up Stripe Checkout

Start to finish, about 30 minutes. You'll do the whole thing in **test mode**
first, so nothing can go wrong with real money.

This assumes the site is already live on Vercel from a GitHub repo — see
`GO-LIVE.md` if it isn't yet.

---

## Step 1 — Get your Stripe test keys

1. Log in to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Flip the **Test mode** toggle on (top right). Everything you do now is fake money.
3. Go to **Developers → API keys**
4. Copy the **Secret key** — starts with `sk_test_`

Keep that tab open. Never put this key in `index.html` or anywhere in the site
files — it belongs in Vercel's environment variables only. Anyone with it can
issue refunds from your account.

---

## Step 2 — Add the environment variables (3 min)

Vercel → your project → **Settings → Environment Variables**. Add two, ticking
all three environments (Production, Preview, Development):

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (the key from step 1) |
| `SITE_URL` | `https://blairsbiltong.co.nz` — no trailing slash |

**Redeploy after adding these.** Environment variables only apply to new
deployments — this catches everyone out at least once. Deployments → latest →
**⋯ → Redeploy**.

---

## Step 3 — Switch the site over (1 min)

In `index.html`, find the `CONFIG` block near the bottom and change one line:

```js
checkoutMode: 'checkout-session',    // was 'payment-link'
```

Commit it. Vercel redeploys automatically.

Your old payment links stay in the file, unused — if anything goes wrong you can
flip that one word back and you're trading again within a minute.

---

## Step 4 — Sanity check before you touch a card

Optional but worth it. From the project folder in a terminal:

```bash
npm install
npm run test:checkout
```

18 checks confirm your pricing, shipping threshold and cart validation behave.
No Stripe account or network needed. Re-run any time you change a price.

---

## Step 5 — Test it properly

Go to your site, add a few packs, hit Checkout. Use Stripe's test cards:

| Card number | What it does |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined — check your error handling |
| `4000 0027 6000 3184` | Triggers 3D Secure |

Any future expiry date, any 3-digit CVC, any postcode.

**Work through this list — each one has caught someone out:**

- [ ] Buy 1 pack → shipping shows **$7.50**
- [ ] Buy 5 packs → shipping shows **Free**
- [ ] Mixed flavours → all appear as separate lines on the Stripe page
- [ ] Address form only offers **New Zealand**
- [ ] After paying, you land on the thank-you page with a reference number
- [ ] The order appears in your Stripe dashboard under **Payments**
- [ ] The customer gets a receipt email
- [ ] Hit the back arrow mid-checkout → you return to the shop
- [ ] Do the whole thing again on your phone

---

## Step 6 — Go live

1. In Stripe, complete **account activation**: NZ business details, IRD number,
   and the bank account you want paid into. Stripe will not release funds until
   this is done, so do it before your first real sale, not after.
2. Turn **Test mode** off, go to **Developers → API keys**, copy the live secret
   key (`sk_live_...`)
3. In Vercel, update `STRIPE_SECRET_KEY` to the live key and confirm `SITE_URL`
   is your real domain
4. Redeploy
5. **Buy something from your own site with your own card.** Refund it afterwards
   from the Stripe dashboard. This is the only way to know it genuinely works.

---

## Optional — order notification emails

Stripe already emails you on every payment, so this is a convenience, not a
requirement. `api/stripe-webhook.js` turns each order into a
formatted packing slip:

```
NEW ORDER — c3d4e5f6g7h8

ITEMS
  2 x Blair's Biltong — Original (50g)   $25.00

Subtotal   $25.00
Shipping   $7.50
TOTAL      $32.50

SHIP TO
  Tom Reid
  8 Buckingham St
  Arrowtown 9302
```

Setup steps are in the comment block at the top of that file.

---

## When you change a price

Prices live in **two** places and both must match, because the server
deliberately ignores whatever the browser sends it — that's what stops someone
editing the page and buying biltong for a cent.

1. `index.html` → `PRODUCTS` array (what the shopper sees)
2. `api/create-checkout-session.js` → `CATALOGUE` (what they're charged)

Then run `npm run test:checkout` and update the expected numbers in
`test/checkout.test.js` if the tests complain.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Could not start checkout" | Function can't reach Stripe, or key is wrong | Vercel → **Logs**, read the actual error |
| 404 on `/api/create-checkout-session` | `api/` folder missing from the repo | Check it uploaded, with all three .js files |
| "Checkout is not configured" | Missing env var | Add both, then **redeploy** — they don't apply retroactively |
| Redirects to `undefined/success.html` | `SITE_URL` not set | Add it, no trailing slash |
| "That cart looks invalid" | Product id mismatch | `PRODUCTS` ids in `index.html` must match `CATALOGUE` keys exactly |
| Cart is empty after cancelling | Known limitation — the cart lives in memory only | Minor; worth fixing later if customers mention it |
| Works in test, fails live | Still on the test key, or account not activated | Check both in step 6 |

---

## Sources

- [Stripe — Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe — Test card numbers](https://docs.stripe.com/testing)
- [Stripe NZ pricing](https://stripe.com/id-nz/pricing)
- [Vercel — Environment variables](https://vercel.com/docs/environment-variables)
- [Vercel — Functions quickstart](https://vercel.com/docs/functions/quickstart)
