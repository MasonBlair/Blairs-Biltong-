# Blair's Biltong — Build Plan

*Prepared 10 August 2026*

---

## 1. The recommendation in one paragraph

Build the site as a real static site (HTML/CSS/JS) hosted free on Vercel, with Stripe handling payment. Your mockup is quite specific — the torn-paper dividers, the mountain hero, the type treatment — and it's the kind of design that a Shopify or Squarespace theme approximates rather than matches. A static site matches it exactly, costs almost nothing to run, and loads fast. The trade-off is that you don't get a merchant dashboard; changing a price means editing one line in a file (or asking me). At your current volume that's the right trade. If you hit the point where you're doing wholesale, managing stock across channels, or printing dozens of shipping labels a day, that's the moment to move to Shopify — and by then the design will be proven and worth paying a themer to port.

---

## 2. Stack

| Layer | Choice | Cost |
|---|---|---|
| Site code | Single-file HTML/CSS/JS (no build step) | $0 |
| Hosting | Vercel free tier (Hobby) | $0 |
| Domain | `blairsbiltong.co.nz` via Cloudflare or 1st Domains | ~$30–40/yr |
| Email | Google Workspace or Zoho Mail | $0–$12/mo |
| Payments | Stripe Checkout | 2.65% + $0.30 per domestic card |
| Forms (email signup) | Vercel function + Resend free tier | $0 |
| Analytics | Plausible or Cloudflare Web Analytics | $0–$14/mo |

**Realistic running cost: $3–5/month.** Compare to ~$45/mo minimum on Shopify before apps.

---

## 3. Stripe: is it worth upgrading from your payment link?

Short answer: yes, but not urgently. Your current setup (pick quantity → click → Stripe payment link) works, and there's no shame in launching with it.

What you're missing, in rough order of how much it'll bite you:

- **Shipping address.** Payment Links can collect one, but you can't vary the rate — no "free shipping over $60", no different North/South Island rate.
- **Mixed carts.** One link per quantity means you need a separate link for every combination once you have more than one flavour. This becomes unmanageable fast.
- **Discount codes.** Hard to run a "FRIENDS20" launch promo cleanly.
- **Order data.** Checkout Sessions give you line items you can read programmatically — useful when you want a packing slip or an order email.
- **Apple Pay / Google Pay.** Meaningfully lifts mobile conversion, and most of your traffic will be mobile from Instagram.

**The upgrade path is small.** One serverless function that takes the cart and returns a Stripe Checkout URL. Vercel runs it free. I've left the hook point in the site code already — flip `checkoutMode` from `'payment-link'` to `'checkout-session'` and it's live.

**Suggested sequencing:** launch on payment links, switch to Checkout Sessions before you add a third flavour or run your first promo.

### Fees (as of 2026)
- Domestic NZ cards: **2.65% + NZ$0.30**
- International cards: **3.50% + NZ$0.30** (+2% if currency conversion)
- On a $12.50 pack: about **$0.63**. On a $50 order: about **$1.63**.

---

## 4. Compliance — worth reading before you scale past friends and family

This is the part that most often catches out food brands going from informal to public sales. Not legal advice, but here's what to check:

**Food Control Plan.** Selling biltong commercially in NZ requires you to be registered under a Food Control Plan. Good news: MPI added a specific **"Making biltong" card** to the Simply Safe & Suitable *template* FCP — which is the cheap, simple option — so you likely don't need a custom plan. Two catches:
- The biltong card covers **retail sale only**. Wholesaling to a shop or gym puts you outside it and into custom-FCP territory.
- Your meat must come from a **registered NZ meat processor** (on the Register of Risk Management Programmes), not a micro-abattoir.
- All FCP-registered businesses were required to be operating under the updated plan as of 30 April 2026.

Run MPI's **"My Food Rules"** tool to confirm what applies to you specifically.

**Labelling.** Your packaged 50g pouches need:
- Nutrition Information Panel (energy, protein, fat/saturated, carbs/sugars, sodium — per serve and per 100g)
- Ingredient list with **allergens bolded**. Since Feb 2026 the "stock-in-trade" grace period has expired — every product on shelf must be fully PEAL-compliant. Relevant to you: soy (in most Worcestershire sauce), gluten (malt vinegar), and any spice blends.
- **Supplier name and physical street address** — a PO Box is not sufficient
- **Lot/batch identification** for recall traceability
- Date marking
- Name that describes the true nature of the food

**Website legals.** Add shipping & returns policy, privacy policy, and terms — Stripe expects these and NZ Fair Trading Act/CGA obligations apply regardless.

---

## 5. Launch checklist

**Before you go live**
- [ ] Point `blairsbiltong.co.nz` at Vercel (see GO-LIVE.md)
- [ ] Set up business email
- [ ] Confirm FCP status with MPI
- [ ] Get compliant labels printed (get the NIP done properly — a lab or a nutrition-analysis service)
- [ ] ~~Product photography~~ — done. Both pouches cut out, hero shot in place
- [ ] Confirm final pricing including postage cost to yourself
- [ ] Stripe account activated (business details, NZ bank account)
- [ ] Write shipping, returns, privacy pages
- [ ] Test a real $1 purchase end to end

**Nice to have at launch**
- [ ] Instagram set up and posting before the site goes live, not after
- [ ] Email capture live from day one, even pre-launch
- [ ] A "notify me when subscriptions launch" list

**Deliberately deferred**
- Subscriptions (build the demand first; fulfilment discipline is the hard part, not the code)
- Customer accounts
- Gift packs
- Wholesale

---

## 6. Phases

**Phase 1 — now.** Static site live, two flavours (Original and Dry Heat), Stripe payment links, email capture. Goal: prove people who aren't your mates will buy.

**Phase 2 — once orders are steady.** Stripe Checkout Sessions, proper shipping rates, discount codes, order confirmation emails. Lifestyle and packaging photography beyond the two product cut-outs.

**Phase 3 — if it's working.** Subscriptions via Stripe Billing, or migrate to Shopify if you're going into retail/wholesale. Decide based on where the orders are coming from, not on ambition.

---

## Sources

- [MPI — Food control plans](https://www.mpi.govt.nz/food-business/running-a-food-business/food-control-plans)
- [MPI — Making biltong (Simply Safe & Suitable card)](https://www.mpi.govt.nz/dmsdocument/70585-Making-biltong)
- [MPI — Simply Safe & Suitable template FCP consultation](https://www.mpi.govt.nz/consultations/simply-safe-and-suitable-template-food-control-plan-and-the-food-notice-food-service-and-food-retail-business-food-control-plan-templates-issued-under-section-39)
- [MPI — Find the food safety rules that apply to your business](https://www.mpi.govt.nz/food-business/food-safety-rules)
- [MPI — Labelling food for retail sale](https://www.mpi.govt.nz/food-business/labelling-composition-food-drinks/labelling-food-for-retail-sale)
- [FSANZ allergen (PEAL) compliance guide](https://foodlabelmaker.com/regulatory-hub/fsanz/peal-allergen-labelling-guide/)
- [Stripe — Lower pricing for New Zealand card transactions](https://support.stripe.com/questions/lower-pricing-for-new-zealand-card-transactions-effective-starting-december-1-2025)
- [Stripe NZ pricing](https://stripe.com/id-nz/pricing)
