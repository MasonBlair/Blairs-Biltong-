/**
 * Database connection for the boss dashboard (stock, batches, supplies).
 * ----------------------------------------------------------------------------
 * Uses Postgres. On Vercel, add a Neon database from the Storage tab; it sets
 * DATABASE_URL for you. Until that exists, everything stock-related switches
 * itself off and the shop behaves exactly as it did before.
 *
 * Tables are created automatically the first time anything asks for them, so
 * there's no separate setup step. Changes to the schema go at the end of
 * MIGRATIONS as a new entry; never edit an old one.
 */
import pg from 'pg';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const hasDb = () => Boolean(URL);

// Return plain values: dates as 'YYYY-MM-DD', numbers as numbers.
pg.types.setTypeParser(1082, v => v);                 // date
pg.types.setTypeParser(1700, v => parseFloat(v));     // numeric
pg.types.setTypeParser(20,   v => parseInt(v, 10));   // bigint (sums, counts)

let pool = null;
function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: URL,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      // Neon needs TLS; a local test database doesn't.
      ssl: /localhost|127\.0\.0\.1|host=\/tmp/.test(URL) ? false : { rejectUnauthorized: false }
    });
    pool.on('error', err => console.error('DB pool error:', err.message));
  }
  return pool;
}

const MIGRATIONS = [
  // 1 — first version of the boss dashboard
  `
  CREATE TABLE IF NOT EXISTS settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    sku        text PRIMARY KEY,           -- e.g. original-100 (matches the shop)
    flavour    text NOT NULL,
    grams      int  NOT NULL,
    low_at     int  NOT NULL DEFAULT 5,     -- warn at or below this many bags
    hidden     boolean NOT NULL DEFAULT false   -- force "sold out" on the shop
  );

  CREATE TABLE IF NOT EXISTS batches (
    id           serial PRIMARY KEY,
    code         text UNIQUE NOT NULL,      -- B001, B002…
    flavour      text NOT NULL,
    cut          text,
    raw_kg       numeric(8,3) NOT NULL,
    meat_cost_cents int,                     -- total paid for the meat in this batch
    started_on   date NOT NULL,
    drying_on    date,
    ready_on     date,
    packed_on    date,
    dried_kg     numeric(8,3),
    best_before  date,
    status       text NOT NULL DEFAULT 'marinating',  -- marinating | drying | ready | packed | closed
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now()
  );

  -- Every change to bagged stock is a row here. On-hand = sum(qty).
  CREATE TABLE IF NOT EXISTS movements (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    sku        text NOT NULL,
    batch_id   int REFERENCES batches(id),
    qty        int NOT NULL,               -- + into stock, − out of stock
    reason     text NOT NULL,              -- packed | online | pickup | honesty | wholesale | sample | waste | staff | return | correction | stocktake
    unit_cents int,                        -- what each bag sold for, if it was a sale
    ref        text,                       -- Stripe checkout id, stocktake id…
    customer   text,                       -- name / email for online orders (for recalls)
    note       text
  );
  CREATE INDEX IF NOT EXISTS movements_sku_idx   ON movements (sku, batch_id);
  CREATE INDEX IF NOT EXISTS movements_at_idx    ON movements (at);
  CREATE INDEX IF NOT EXISTS movements_ref_idx   ON movements (ref);
  CREATE INDEX IF NOT EXISTS movements_batch_idx ON movements (batch_id);

  -- Stripe can deliver the same webhook twice; this makes sure a sale only counts once.
  CREATE TABLE IF NOT EXISTS processed_orders (
    session_id text PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS supplies (
    id           serial PRIMARY KEY,
    name         text NOT NULL,
    category     text NOT NULL DEFAULT 'packaging',   -- packaging | ingredient | other
    unit         text NOT NULL DEFAULT 'each',
    on_hand      numeric(12,2) NOT NULL DEFAULT 0,
    reorder_at   numeric(12,2),
    reorder_qty  numeric(12,2),
    cost_cents   numeric(12,4),           -- cost per unit
    supplier     text,
    auto_use     text,                    -- bag-50 | bag-100 | bag-200 | bag-any | raw-kg | null
    use_per      numeric(12,4) NOT NULL DEFAULT 1,
    sort         int NOT NULL DEFAULT 100,
    archived     boolean NOT NULL DEFAULT false
  );

  CREATE TABLE IF NOT EXISTS supply_moves (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    supply_id  int NOT NULL REFERENCES supplies(id),
    qty        numeric(12,2) NOT NULL,
    reason     text NOT NULL,            -- received | used | batch | packed | correction
    batch_id   int REFERENCES batches(id),
    cost_cents numeric(12,4),
    note       text
  );

  -- "Tell me when it's back" signups from sold-out cards on the shop.
  CREATE TABLE IF NOT EXISTS waitlist (
    id          serial PRIMARY KEY,
    email       text NOT NULL,
    flavour     text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    notified_at timestamptz,
    UNIQUE (email, flavour)
  );
  `
];

let ready = null;
async function migrate(client) {
  await client.query('SELECT pg_advisory_lock(424242)');
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_version (v int NOT NULL)');
    const { rows } = await client.query('SELECT v FROM schema_version');
    let v = rows[0]?.v ?? 0;
    if (!rows.length) await client.query('INSERT INTO schema_version VALUES (0)');
    for (; v < MIGRATIONS.length; v++) {
      await client.query('BEGIN');
      await client.query(MIGRATIONS[v]);
      await client.query('UPDATE schema_version SET v = $1', [v + 1]);
      await client.query('COMMIT');
    }
    const { seed } = await import('./seed.js');
    await seed(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)');
  }
}

async function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const c = await getPool().connect();
      try { await migrate(c); } finally { c.release(); }
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

/** Run one query. */
export async function q(text, params) {
  await ensureReady();
  return getPool().query(text, params);
}

/**
 * Run several queries as one all-or-nothing step. Stock writes also take a
 * lock so two sales at the same moment can't both grab the last bag.
 */
export async function tx(fn) {
  await ensureReady();
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(777)');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** For tests only. */
export async function _closeDb() { if (pool) { await pool.end(); pool = null; ready = null; } }
