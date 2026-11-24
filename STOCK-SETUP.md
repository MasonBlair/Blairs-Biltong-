# Boss dashboard: stock, batches, supplies, numbers

Lives behind the Dispatch app (`/dispatch.html`), same password. Tabs:

- **Today**: orders to ship, last 7 days, bags on hand, when to start the next batch, anything needing attention.
- **Orders**: the dispatch page as before, plus which batch each order's bags came from.
- **Stock**: bags per flavour and size (tap one for batch breakdown, history and settings), Record in / out, Stocktake. **Supplies**: pouches, labels and ingredients, with reorder levels.
- **Batches**: start a batch, move it through marinate → dry → ready → pack. Packing puts bags into stock with a best-before. Each batch shows yield, weight loss, cost, and who got its bags (for recalls).
- **Recipe** (Today, Batches, and inside a marinating batch): type the trimmed weight and it lists the marinade (salt, malt vinegar in grams, Lea & Perrins) and the spice mix, with tick boxes. Recipe amounts per kg are editable under Edit the recipe; Dry Heat chilli is blank until you set it.
- **Numbers**: sales, weekly chart, what's selling and where, pace per size, next-batch forecast, cost per bag and margin, batch history.
- **Safety**: food safety records in place of the paper pack. Fridge temps, cleaning, calibration and corrective actions, plus the full 11-section batch record for each batch (receiving → CCP 1 → CCP 2 → release). Checks against your limits are done on the server. Reminders for routine checks show in the app until done or marked not done. Printable records for your verifier, and a full backup.
- **Settings** (top right): live stock on/off, "only N left", shelf life, alerts, back-in-stock list.

## How stock moves

| What happens | Stock |
|---|---|
| Pack a batch | + bags, tagged with the batch |
| Paid online order (Stripe webhook, plus a catch-up each time the app opens) | − bags, oldest batch first, customer recorded |
| Record in / out (honesty box, wholesale, samples, wastage, eaten, returns) | ± bags |
| Stocktake | sets each size to what you counted, logs the difference |

Starting a batch takes the recipe ingredients off supplies (per kg raw). Packing takes pouches and labels.

## One-time setup

1. **Add the database before pushing.** Vercel → this project → **Storage** → **Create Database** → **Neon** (free plan, Sydney region) → connect it to this project for all environments. That adds `DATABASE_URL`. Tables create themselves on first use.
2. **Push** in GitHub Desktop. Vercel deploys with the database connected.
3. Optional: **weekly summary email** every Sunday ~5:30 pm. Add env var `CRON_SECRET` (any long random text), then redeploy or push.
4. Check **Stripe → Developers → Webhooks** has an endpoint for `https://blairsbiltong.co.nz/api/stripe-webhook` with the event `checkout.session.completed`, and that `STRIPE_WEBHOOK_SECRET` is set in Vercel. If it isn't, orders are still picked up each time you open the app.
5. In the app: Stock → **Stocktake** (count your bags), Supplies → **Count** each one, then Settings → **Live stock on the shop**.

Until step 5, the shop keeps using the `soldOut` flags in `api/_lib/catalogue.js` and `index.html`, exactly as before.

## Files

- `api/boss.js`: dashboard data and every change (password protected)
- `api/stock.js`: public: what's in stock for the shop, and "tell me when it's back" signups
- `api/digest.js`: weekly email (Vercel cron, see `vercel.json`)
- `api/_lib/db.js`: database connection and tables
- `api/_lib/stock.js`: the stock engine (FIFO by batch, orders, supplies, alerts)
- `api/_lib/catalogue.js`: flavours, sizes and prices (shared by checkout and stock)
- `api/_lib/seed.js`: starting supplies and settings for a fresh database

## Food safety records

- Every record is time-stamped and signed with your initials. Corrections save a new version with a reason; the old one is kept. Removing a record marks it "not valid" with a reason. Nothing is ever silently overwritten.
- Limits (Safety → Safety settings) come from the food control plan: chiller ≤ 5 °C, salt ≥ 30 g/kg, marinating ≥ 10 h, thickest slice ≤ 17 mm, aw below 0.85. Set the **release threshold** (% weight loss) once lab validation gives you the number.
- A failed check opens a corrective action, filled in with what failed. A batch can't be released while one of its checks failed or a corrective action is open.
- **Records for your verifier** opens a printable page in Safari (Share → Print, or save as PDF). **Back up everything** downloads every record as a file. Do this every month or so and keep the file.
- Run paper alongside for a batch or two, and show your verifier before dropping paper.

Files: `api/_lib/safety.js` (forms, limits, checks, reminders), `api/_lib/safety-db.js` (saving, history, printout).

## Money

- Each online order's real figures come from Stripe (paid, discount, shipping, Stripe fee, refunds): saved when the webhook fires, and caught up every time the app opens, including the last 90 days of orders from before the database existed. Read-only: nothing is charged or refunded.
- Enter what you paid NZ Post in the **Postage you paid** box when you dispatch (or later, on the shipped order).
- Numbers → Money: what customers paid, Stripe fees, what you received, postage, cost to make the biltong (from your batches' cost per 100 g), and profit.

File: `api/_lib/finance.js`.
