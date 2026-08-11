# Blair's Biltong — site

Static site, no build step. Open `index.html` in a browser to preview.

```
blairs-biltong/
├── index.html          ← the entire site (HTML + CSS + JS in one file)
├── success.html        ← post-purchase thank-you page
├── BUILD-PLAN.md       ← platform choice, costs, NZ compliance, launch checklist
├── STRIPE-SETUP.md     ← step-by-step Stripe Checkout walkthrough
├── package.json        ← declares the Stripe dependency
├── GO-LIVE.md          ← deploying to Vercel + pointing the domain  ★ start here
├── vercel.json         ← headers and caching
├── robots.txt          ← keeps it out of Google pre-launch (delete on launch)
├── assets/             ← logo, hero, two pouch cut-outs
├── api/
│   ├── create-checkout-session.js   ← prices the cart, returns a Stripe URL
│   ├── stripe-webhook.js            ← optional order-notification emails
│   └── subscribe.js                 ← email signup form handler
└── test/
    └── checkout.test.js             ← 18 checks on pricing and cart validation
```

## Deploy

Follow **GO-LIVE.md**. Short version: push to a GitHub repo, import it in
Vercel, add the domain. Every push redeploys automatically.

## Run the tests

```bash
npm install
npm run test:checkout
```

Re-run these any time you touch a price or the shipping threshold.

## Changing prices or flavours

Two files, and they must agree:

```js
// index.html — what the shopper sees
{ id:'original', name:'Original', desc:'Classic. Traditional. Delicious.',
  price:12.50, weight:'50g', img:'assets/pouch-original.png' }

// api/create-checkout-session.js — what they're charged
original: { name: "Blair's Biltong — Original (50g)", cents: 1250 }
```

The server ignores prices sent by the browser on purpose — that's what stops
someone editing the page and buying biltong for a cent.

## Photography

| Slot | Status | File |
|---|---|---|
| Hero | Real photo | `assets/hero.jpg` |
| Original pouch | Real photo, background removed | `assets/pouch-original.png` |
| Dry Heat pouch | Real photo, background removed | `assets/pouch-dryheat.png` |
| Subscribe box shot | Still a CSS placeholder, tagged on screen | `.boxshot` div in `index.html` |

The pouch cut-outs were made by masking on colour — the kraft paper is strongly
warm, the studio backdrop is neutral, so the two separate cleanly. If you reshoot
on a different backdrop, keep it neutral grey or white and the same trick works.

To add a flavour: drop the photo in `assets/`, add an entry to `PRODUCTS` in
`index.html` and to `CATALOGUE` in the checkout function.

## Still to fill in

- Real customer reviews — the three currently on the page came from the mockup
  and are not real people
- Nutrition Information Panel values — needs proper analysis
- Final allergen statement, PEAL-compliant with allergens bolded
- Shipping, returns, privacy and contact pages (footer links are dead)
- Real "Our Story" copy
- Instagram and Facebook URLs in the footer
