# Boss dashboard: stock, batches, supplies, numbers

Lives behind the Dispatch app (`/dispatch.html`), same password. Tabs:

- **Today**: orders to ship, last 7 days, bags on hand, when to start the next batch, anything needing attention.
- **Orders**: the dispatch page as before, plus which batch each order's bags came from.
- **Stock**: bags per flavour and size (tap one for batch breakdown, history and settings), Record in / out, Stocktake. **Supplies**: pouches, labels and ingredients, with reorder levels.
- **Batches**: start a batch, move it through marinate → dry → ready → pack. Packing puts bags into stock with a best-before. Each batch shows yield, weight loss, cost, and who got its bags (for recalls).
- **Numbers**: sales, weekly chart, what's selling and where, pace per size, next-batch forecast, cost per bag and margin, batch history.
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
