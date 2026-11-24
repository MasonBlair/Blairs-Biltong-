/**
 * CATALOGUE — prices in CENTS. Must mirror FLAVOURS / SIZES in index.html.
 * This is the source of truth for what a customer is charged, and for which
 * bag sizes the stock dashboard tracks.
 *
 * soldOut: true → checkout refuses it, whatever the browser sends.
 * Once live stock is switched on in the dashboard, these flags are ignored and
 * the real stock numbers decide instead.
 */

// One entry per flavour × bag size. Ids look like "original-100".
export const FLAVOURS = {
  original: { label: 'Original', soldOut: false },
  dryheat:  { label: 'Dry Heat', soldOut: true }
};
export const SIZES = { 50: 750, 100: 1500, 200: 3000 };   // grams → cents (linear for now)
export const SIZE_LABELS = { 50: 'Snack Pack', 100: 'Large', 200: 'Share Bag' };

export const CATALOGUE = Object.fromEntries(
  Object.entries(FLAVOURS).flatMap(([flavour, f]) =>
    Object.entries(SIZES).map(([grams, cents]) => [
      `${flavour}-${grams}`,
      { name: `Blair's Biltong — ${f.label} ${grams}g ${SIZE_LABELS[grams]}`, cents: Number(cents), soldOut: f.soldOut }
    ])));

