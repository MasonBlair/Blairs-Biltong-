/**
 * Starting data for a brand-new database. Runs on every cold start but only
 * ever adds what's missing, so edits made in the dashboard are never undone.
 */
import { CATALOGUE } from './catalogue.js';

export const DEFAULT_SETTINGS = {
  live: false,              // shop uses these stock numbers (turn on after your first stocktake)
  showLeftUnder: 5,         // shop says "Only 3 left" at or below this
  shelfLifeMonths: 3,
  bestBeforeWarnDays: 21,
  emailAlerts: true,
  batchLeadDays: 6,         // slice Monday → packed by the weekend
  nextBatchNo: 1
};

// Recipe usage per kg raw meat (locked Sep 2026), and the packaging each bag uses.
const SUPPLIES = [
  ['Pouches 50 g',             'packaging',  'pouches', 'bag-50',  1,    10],
  ['Pouches 100 g',            'packaging',  'pouches', 'bag-100', 1,    11],
  ['Pouches 200 g',            'packaging',  'pouches', 'bag-200', 1,    12],
  ['Labels 50 × 80 mm',        'packaging',  'labels',  'bag-50',  1,    20],
  ['Labels 70 × 100 mm',       'packaging',  'labels',  'bag-100+',1,    21],
  ['Salt (iodised)',           'ingredient', 'g',       'raw-kg',  40,   30],
  ['Malt vinegar',             'ingredient', 'mL',      'raw-kg',  100,  31],
  ['Lea & Perrins',            'ingredient', 'mL',      'raw-kg',  60,   32],
  ['Coriander seed',           'ingredient', 'g',       'raw-kg',  40,   33],
  ['Black pepper',             'ingredient', 'g',       'raw-kg',  26.7, 34]
];

export async function seed(c) {
  for (const sku of Object.keys(CATALOGUE)) {
    const [flavour, grams] = sku.split('-');
    const low = { 50: 6, 100: 4, 200: 2 }[grams] ?? 4;
    await c.query(
      `INSERT INTO products (sku, flavour, grams, low_at) VALUES ($1,$2,$3,$4) ON CONFLICT (sku) DO NOTHING`,
      [sku, flavour, Number(grams), low]);
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await c.query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]);
  }
  const { rows } = await c.query(`SELECT value FROM settings WHERE key = 'suppliesSeeded'`);
  if (!rows.length) {
    for (const [name, category, unit, autoUse, per, sort] of SUPPLIES) {
      await c.query(
        `INSERT INTO supplies (name, category, unit, auto_use, use_per, sort) VALUES ($1,$2,$3,$4,$5,$6)`,
        [name, category, unit, autoUse, per, sort]);
    }
    await c.query(`INSERT INTO settings (key, value) VALUES ('suppliesSeeded', 'true')`);
  }
}
