/**
 * Saving and reading food safety records, reminders, and the verifier printout.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';
import { getSettings, setSettings } from './stock.js';
import {
  FS_DEFAULTS, FS_REMINDER_DEFAULTS, BATCH_SECTIONS, LOG_FORMS, CALIBRATION, CLEAN_AREAS,
  evaluate, dueReminders, batchProgress, releaseChecks, sliceResults, nzToDate
} from './safety.js';

export const LOG_KINDS = ['chiller', 'cleaning', 'calibration', 'corrective'];

export async function fsSettings(c) {
  const s = await getSettings(c);
  const fs = s.fs || {};
  return {
    ...FS_DEFAULTS, ...fs,
    limits: { ...FS_DEFAULTS.limits, ...(fs.limits || {}) },
    recipe: { ...FS_DEFAULTS.recipe, ...(fs.recipe || {}) },
    remindersOn: s.fsRemindersOn ?? true,
    reminders: s.fsReminders || FS_REMINDER_DEFAULTS
  };
}

const CUR = `NOT superseded AND NOT void`;

/** Current version of each section of one batch's record. */
export async function batchSections(c, batchId) {
  const { rows } = await c.query(`SELECT * FROM fs_records WHERE kind = 'batch' AND batch_id = $1 AND ${CUR}`, [batchId]);
  const S = {};
  for (const r of rows) S[r.section] = r;
  return S;
}

async function openCorrectiveFor(c, batchId) {
  const { rows } = await c.query(
    `SELECT COUNT(*)::int AS n FROM fs_records WHERE kind = 'corrective' AND ${CUR}
       AND COALESCE((data->>'closed')::boolean, false) = false AND ($1::int IS NULL OR batch_id = $1)`, [batchId]);
  return rows[0].n;
}

/**
 * Save a record (new, or a corrected version of an existing one).
 * Checks are worked out here, not trusted from the phone.
 */
export async function saveRecord(c, b, fail) {
  const s = await fsSettings(c);
  const kind = String(b.kind || '');
  if (kind !== 'batch' && !LOG_KINDS.includes(kind)) fail('Unknown record type');
  const section = kind === 'batch' ? String(b.section || '') : null;
  if (kind === 'batch' && !BATCH_SECTIONS.some(x => x.key === section)) fail('Unknown section');
  const batchId = b.batchId ? Number(b.batchId) : null;
  if (kind === 'batch' && !batchId) fail('Pick a batch');
  const at = b.at && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at) : new Date();
  if (at > new Date(Date.now() + 10 * 60000)) fail('That time is in the future');
  const data = typeof b.data === 'object' && b.data ? b.data : {};
  const initials = String(b.initials || s.initials || '').trim().slice(0, 8) || null;
  if (!initials) fail('Add your initials first (Safety → Settings)');

  let prev = null;
  if (b.replaces) {
    const { rows } = await c.query(`SELECT * FROM fs_records WHERE id = $1`, [Number(b.replaces)]);
    prev = rows[0];
    if (!prev || prev.superseded || prev.void) fail('That record has already been changed. Refresh and try again.');
    if (!String(b.reason || '').trim()) fail('Say why you’re changing it');
  } else if (kind === 'batch') {
    const { rows } = await c.query(`SELECT id FROM fs_records WHERE kind = 'batch' AND batch_id = $1 AND section = $2 AND ${CUR}`, [batchId, section]);
    if (rows.length) prev = { id: rows[0].id };    // re-saving a section = a new version
  }

  const ctx = {};
  if (kind === 'batch') {
    ctx.sections = await batchSections(c, batchId);
    const { rows: [bt] } = await c.query('SELECT raw_kg, flavour FROM batches WHERE id = $1', [batchId]);
    if (!bt) fail('Batch not found');
    ctx.rawKg = bt.raw_kg; ctx.flavour = bt.flavour;
  }

  let result;
  if (kind === 'batch' && section === 'release') {
    const S = ctx.sections;
    const checks = releaseChecks(S, await openCorrectiveFor(c, batchId));
    const bad = checks.filter(x => !x.ok);
    if (bad.length) fail('Not ready to release: ' + bad.map(x => x.label).join('; '));
    result = { pass: true, fails: [], notes: [], missing: [], derived: { checks } };
  } else {
    result = evaluate(kind, section, data, at, s, ctx);
  }

  // Daily logs must be complete; batch sections can be saved part-done (e.g. raw slice weights first).
  if (kind !== 'batch' && result.missing.length) fail('Still needed: ' + result.missing.join(', '));

  if (prev) await c.query(`UPDATE fs_records SET superseded = true WHERE id = $1`, [prev.id]);
  const { rows: [row] } = await c.query(
    `INSERT INTO fs_records (kind, section, batch_id, at, data, pass, result, initials, replaces, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [kind, section, batchId, at, JSON.stringify(data), result.pass,
      JSON.stringify({ fails: result.fails, notes: result.notes, missing: result.missing, derived: result.derived }),
      initials, prev?.id || null, prev ? String(b.reason || 'Updated').slice(0, 300) : null]);

  // A chiller reading over the limit while a batch is marinating affects that batch.
  return { id: row.id, pass: result.pass, fails: result.fails, notes: result.notes, missing: result.missing, derived: result.derived };
}

export async function voidRecord(c, b, fail) {
  const reason = String(b.reason || '').trim();
  if (!reason) fail('Say why it’s being removed');
  const { rowCount } = await c.query(`UPDATE fs_records SET void = true, reason = $2 WHERE id = $1 AND ${CUR}`, [Number(b.id), reason.slice(0, 300)]);
  if (!rowCount) fail('Already changed');
  return { msg: 'Marked as not valid. It’s kept in the history.' };
}

/** "Didn't happen" is a record too — better than a blank. */
export async function skipReminder(c, b, fail) {
  const s = await fsSettings(c);
  const r = s.reminders.find(x => x.id === b.reminderId);
  if (!r) fail('Unknown reminder');
  const reason = String(b.reason || '').trim();
  if (!reason) fail('Say why it was skipped');
  await c.query(`INSERT INTO fs_records (kind, at, data, initials, result) VALUES ('skip', now(), $1, $2, '{}')`,
    [JSON.stringify({ reminderId: r.id, title: r.title, reason: reason.slice(0, 300) }), s.initials || null]);
  return { msg: 'Noted as not done' };
}

export async function saveFsSettings(c, b, fail) {
  const cur = (await getSettings(c)).fs || {};
  const next = { ...cur };
  if ('initials' in b) next.initials = String(b.initials || '').trim().toUpperCase().slice(0, 8);
  if (Array.isArray(b.units)) next.units = b.units.map(u => String(u).trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  if (!next.units?.length) next.units = FS_DEFAULTS.units;
  if (b.limits) {
    const L = { ...FS_DEFAULTS.limits, ...(cur.limits || {}) };
    for (const k of Object.keys(FS_DEFAULTS.limits)) {
      if (!(k in b.limits)) continue;
      const v = b.limits[k];
      if (v === '' || v == null) { if (k === 'releaseLossPct') L[k] = null; continue; }
      const n = Number(v); if (!Number.isFinite(n) || n < 0) fail('Check the limits'); L[k] = n;
    }
    next.limits = L;
  }
  if (b.recipe) {
    const R = { ...FS_DEFAULTS.recipe, ...(cur.recipe || {}) };
    for (const k of Object.keys(FS_DEFAULTS.recipe)) {
      if (!(k in b.recipe)) continue;
      const v = b.recipe[k];
      if (v === '' || v == null) { if (k === 'chilli') R[k] = null; continue; }
      const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1000) fail('Check the recipe amounts'); R[k] = n;
    }
    next.recipe = R;
  }
  const patch = { fs: next };
  if ('remindersOn' in b) patch.fsRemindersOn = Boolean(b.remindersOn);
  if (Array.isArray(b.reminders)) {
    patch.fsReminders = b.reminders.slice(0, 20).map((r, i) => ({
      id: String(r.id || 'r' + Date.now() + i).slice(0, 40),
      title: String(r.title || 'Check').slice(0, 60),
      kind: ['chiller', 'cleaning', 'calibration'].includes(r.kind) ? r.kind : 'chiller',
      freq: ['daily', 'weekly', 'monthly'].includes(r.freq) ? r.freq : 'daily',
      days: (Array.isArray(r.days) ? r.days : []).map(Number).filter(d => d >= 1 && d <= 7),
      monthDay: Math.min(28, Math.max(1, Number(r.monthDay) || 1)),
      time: /^\d{2}:\d{2}$/.test(r.time) ? r.time : '09:00',
      enabled: Boolean(r.enabled)
    }));
  }
  await setSettings(c, patch);
  return { msg: 'Saved' };
}

/* ------------------------------------------------------------------ reading */
/** What the dashboard needs: due reminders, open issues, batch progress. */
export async function safetySummary(batchIds = []) {
  const s = await fsSettings();
  const { rows: recent } = await q(`SELECT id, kind, at, data FROM fs_records WHERE at > now() - interval '35 days' AND ${CUR}`);
  const due = s.remindersOn ? dueReminders(s.reminders, recent) : [];
  const { rows: oc } = await q(`SELECT id, batch_id, data, at FROM fs_records WHERE kind = 'corrective' AND ${CUR}
                                  AND COALESCE((data->>'closed')::boolean, false) = false ORDER BY at DESC`);
  const { rows: secs } = batchIds.length
    ? await q(`SELECT batch_id, section, pass, result, at FROM fs_records WHERE kind = 'batch' AND batch_id = ANY($1) AND ${CUR}`, [batchIds])
    : { rows: [] };
  const byBatch = {};
  for (const r of secs) (byBatch[r.batch_id] ||= {})[r.section] = r;
  const batches = Object.fromEntries(batchIds.map(id => {
    const S = byBatch[id] || {};
    // When each step was recorded, so the batch card can say when to be back.
    const times = Object.fromEntries(['marinate_start', 'marinate_end', 'drying_start', 'drying_end'].filter(k => S[k]).map(k => [k, S[k].at]));
    return [id, { ...batchProgress(S), times }];
  }));
  // Failed checks that haven't been dealt with: no action written on them and
  // no corrective action record logged since.
  const { rows: fails } = await q(`SELECT f.id, f.kind, f.section, f.batch_id, f.at, f.result FROM fs_records f
     WHERE f.pass = false AND NOT f.superseded AND NOT f.void AND f.at > now() - interval '14 days'
       AND COALESCE(f.data->>'action', '') = ''
       AND NOT EXISTS (SELECT 1 FROM fs_records ca WHERE ca.kind = 'corrective' AND NOT ca.superseded AND NOT ca.void
                        AND ca.created_at >= f.created_at AND (f.batch_id IS NULL OR ca.batch_id IS NULL OR ca.batch_id = f.batch_id))
     ORDER BY f.at DESC LIMIT 10`);
  return {
    initials: s.initials, due, openCorrective: oc.map(r => ({ id: r.id, batchId: r.batch_id, what: r.data.what, at: r.at })),
    batches, recentFails: fails.map(f => ({ ...f, fails: f.result?.fails || [] }))
  };
}

/** Everything the Safety tab shows. */
export async function safetyView() {
  const s = await fsSettings();
  const { rows } = await q(`SELECT r.*, b.code FROM fs_records r LEFT JOIN batches b ON b.id = r.batch_id
                             WHERE r.kind <> 'batch' AND ${CUR.replace(/superseded|void/g, m => 'r.' + m)}
                               AND r.at > now() - interval '60 days' ORDER BY r.at DESC LIMIT 300`);
  const { rows: last } = await q(`SELECT DISTINCT ON (kind, section) kind, section, data FROM fs_records
                                   WHERE ${CUR} ORDER BY kind, section, at DESC`);
  const remember = {};
  for (const r of last) remember[r.section || r.kind] = r.data;
  const { rows: chill } = await q(`SELECT at, data->>'readingC' AS c, data->>'unit' AS unit FROM fs_records
                                    WHERE kind = 'chiller' AND ${CUR} ORDER BY at DESC LIMIT 20`);
  return {
    settings: s, records: rows, remember, chillerTrend: chill.reverse().map(x => ({ at: x.at, c: Number(x.c), unit: x.unit })),
    schema: { batch: BATCH_SECTIONS, logs: LOG_FORMS, calibration: CALIBRATION, cleanAreas: CLEAN_AREAS }
  };
}

/** One batch's record: current sections, their history, release checklist. */
export async function batchRecord(batchId) {
  const { rows } = await q(`SELECT * FROM fs_records WHERE kind = 'batch' AND batch_id = $1 ORDER BY created_at`, [batchId]);
  const S = {};
  for (const r of rows) if (!r.superseded && !r.void) S[r.section] = r;
  const open = await openCorrectiveFor({ query: q }, batchId);
  const { rows: ca } = await q(`SELECT * FROM fs_records WHERE kind = 'corrective' AND batch_id = $1 AND ${CUR} ORDER BY at DESC`, [batchId]);
  return { sections: S, history: rows.filter(r => r.superseded || r.void), release: releaseChecks(S, open),
    progress: batchProgress(S), corrective: ca };
}

/* ------------------------------------------------------------------ verifier printout */
// A short-lived signed link, so the printout can open in Safari (where Print
// and Save as PDF work) without putting your password in the address.
const sign = s => createHmac('sha256', process.env.DISPATCH_PASSWORD || 'x').update(s).digest('hex').slice(0, 32);
export function printToken(from, to) {
  const exp = Date.now() + 15 * 60000;
  const payload = `${from}.${to}.${exp}`;
  return `${payload}.${sign(payload)}`;
}
export function readPrintToken(t) {
  const parts = String(t || '').split('.');
  if (parts.length !== 4) return null;
  const [from, to, exp, sig] = parts;
  const want = sign(`${from}.${to}.${exp}`);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Date.now() > Number(exp)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return { from, to };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nzTime = d => new Date(d).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const nzDay = d => new Date(d).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function fieldValue(f, v, derived) {
  if (f.type === 'info') return esc(derived?.[f.k] ?? '—');
  if (f.type === 'tick') return v === true ? '✓ Yes' : '<b class="no">✗ No</b>';
  if (f.type === 'slices') return '';
  if (v == null || v === '') return '<span class="dim">—</span>';
  return esc(v) + (f.unit ? ' ' + esc(f.unit) : '');
}

function resultLine(r) {
  const res = r.result || {};
  const bits = [];
  if (r.pass === true) bits.push('<span class="ok">PASS</span>');
  if (r.pass === false) bits.push('<span class="bad">FAIL</span>');
  if (r.pass === null && r.kind !== 'corrective') bits.push('<span class="dim">Incomplete</span>');
  for (const f of res.fails || []) bits.push(`<span class="bad">${esc(f)}</span>`);
  for (const n of res.notes || []) bits.push(`<span class="warn">${esc(n)}</span>`);
  for (const m of res.missing || []) bits.push(`<span class="dim">Missing: ${esc(m)}</span>`);
  return bits.join(' · ');
}

export async function printHtml(from, to) {
  const start = nzToDate(from, '00:00'), end = new Date(nzToDate(to, '23:59').getTime() + 59999);
  const { rows: recs } = await q(`SELECT r.*, b.code, b.flavour, b.raw_kg FROM fs_records r LEFT JOIN batches b ON b.id = r.batch_id
                                   WHERE r.at BETWEEN $1 AND $2 OR (r.kind = 'batch' AND r.batch_id IN (
                                     SELECT batch_id FROM fs_records WHERE kind = 'batch' AND at BETWEEN $1 AND $2))
                                   ORDER BY r.at, r.created_at`, [start, end]);
  const current = recs.filter(r => !r.superseded && !r.void);
  const changed = recs.filter(r => r.superseded || r.void);
  const prevChain = r => { const out = []; let p = r.replaces; while (p) { const x = recs.find(y => y.id === p); if (!x) break; out.push(x); p = x.replaces; } return out; };

  const oldValues = p => {
    const fields = p.kind === 'batch' ? (BATCH_SECTIONS.find(x => x.key === p.section)?.fields || []) : (LOG_FORMS[p.kind]?.fields || []);
    return fields.map(f => {
      const v = p.data?.[f.k];
      if (f.type === 'info' || v === undefined || v === null || v === '') return null;
      if (f.type === 'slices') return `${(v || []).length} slices`;
      if (f.type === 'checklist') return `${f.label}: ${Object.keys(v || {}).join(', ')}`;
      if (f.type === 'tick') return `${f.label}: ${v ? 'Yes' : 'No'}`;
      return `${f.label}: ${v}${f.unit ? ' ' + f.unit : ''}`;
    }).filter(Boolean).map(esc).join(' · ') || 'No values';
  };
  const edits = r => {
    const chain = prevChain(r);
    if (!chain.length) return '';
    return `<div class="edit">Corrected ${esc(nzTime(r.created_at))} by ${esc(r.initials)}: ${esc(r.reason)}. Earlier version${chain.length > 1 ? 's' : ''} kept below.
      ${chain.map(p => `<div class="old">${esc(nzTime(p.created_at))} · ${esc(p.initials)} · ${oldValues(p)}</div>`).join('')}</div>`;
  };

  // Batch records
  const batchIds = [...new Set(current.filter(r => r.kind === 'batch').map(r => r.batch_id))];
  let html = '';
  for (const id of batchIds) {
    const rs = current.filter(r => r.kind === 'batch' && r.batch_id === id);
    const b = rs[0];
    html += `<section class="batch"><h2>Batch record · ${esc(b.code)} · ${esc(b.flavour === 'dryheat' ? 'Dry Heat' : 'Original')} · ${esc(b.raw_kg)} kg raw</h2>`;
    for (const sec of BATCH_SECTIONS) {
      const r = rs.find(x => x.section === sec.key);
      html += `<div class="sec"><h3>${sec.no}. ${esc(sec.title)}${sec.ccp ? ` <span class="ccp">${esc(sec.ccp)}</span>` : ''}</h3>`;
      if (!r) { html += `<p class="dim">Not recorded.</p></div>`; continue; }
      html += `<p class="meta">${esc(nzTime(r.at))} · ${esc(r.initials || '')} · ${resultLine(r)}</p>`;
      if (sec.key === 'release') {
        html += `<table>${(r.result?.derived?.checks || []).map(c => `<tr><td>${esc(c.label)}</td><td>${c.ok ? '✓' : '✗'}</td></tr>`).join('')}
          <tr><td><b>Released for sale</b></td><td><b>${esc(r.initials)} · ${esc(nzTime(r.at))}</b></td></tr></table>`;
      } else {
        html += `<table>${sec.fields.filter(f => f.type !== 'slices').map(f => `<tr><td>${esc(f.label)}</td><td>${fieldValue(f, r.data[f.k], r.result?.derived)}</td></tr>`).join('')}</table>`;
        if (sec.key === 'slices') {
          const sl = r.result?.derived?.slices || [];
          html += `<table class="grid"><tr><th>Slice</th><th>Thick mm</th><th>Raw g</th><th>Dry g</th><th>Loss %</th><th>Pass</th></tr>${sl.map(x =>
            `<tr><td>${x.no}</td><td>${x.thick ?? ''}</td><td>${x.raw ?? ''}</td><td>${x.dry ?? ''}</td><td>${x.loss ?? ''}</td><td>${x.pass == null ? '' : x.pass ? '✓' : '<b class="no">✗</b>'}</td></tr>`).join('')}</table>`;
        }
      }
      html += edits(r) + `</div>`;
    }
    html += `</section>`;
  }

  const table = (title, kind, head, row) => {
    const rs = current.filter(r => r.kind === kind && new Date(r.at) >= start && new Date(r.at) <= end);
    return `<section><h2>${title}</h2>${rs.length ? `<table class="grid"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rs.map(r => `<tr>${row(r).map(c => `<td>${c}</td>`).join('')}</tr>${prevChain(r).length ? `<tr><td colspan="${head.length}">${edits(r)}</td></tr>` : ''}`).join('')}</table>` : '<p class="dim">No entries in this period.</p>'}</section>`;
  };
  html += table('Chiller temperature log', 'chiller', ['Date and time', 'Fridge', 'Reading', 'Result', 'Action', 'Initials'],
    r => [esc(nzTime(r.at)), esc(r.data.unit || ''), esc(r.data.readingC) + ' °C', resultLine(r), esc(r.data.action || ''), esc(r.initials || '')]);
  html += table('Cleaning and sanitising log', 'cleaning', ['Date and time', 'Area or equipment', 'Cleaned', 'Sanitised', 'Product', 'Initials'],
    r => {
      const a = Object.entries(r.data.areas || {}).filter(([, v]) => v?.cleaned || v?.sanitised);
      return [esc(nzTime(r.at)), a.map(([k]) => esc(k)).join('<br>'), a.map(([, v]) => v.cleaned ? '✓' : '✗').join('<br>'), a.map(([, v]) => v.sanitised ? '✓' : '✗').join('<br>'), esc(r.data.product || ''), esc(r.initials || '')];
    });
  html += table('Calibration log', 'calibration', ['Date and time', 'Equipment', 'Check', 'Reference', 'Reading', 'Result', 'Action', 'Initials'],
    r => { const e = CALIBRATION.find(c => c.id === r.data.equipment) || {}; return [esc(nzTime(r.at)), esc(e.label || ''), esc(e.check || ''), esc(r.data.reference) + ' ' + esc(e.unit || ''), esc(r.data.reading) + ' ' + esc(e.unit || ''), resultLine(r), esc(r.data.action || ''), esc(r.initials || '')]; });
  html += `<section><h2>Corrective action records</h2>${current.filter(r => r.kind === 'corrective').map(r => `<div class="sec"><p class="meta">${esc(nzTime(r.at))} · ${esc(r.initials || '')}${r.code ? ' · Batch ' + esc(r.code) : ''} · ${r.data.closed ? '<span class="ok">Closed</span>' : '<span class="warn">Open</span>'}</p>
     <table>${LOG_FORMS.corrective.fields.filter(f => f.k !== 'closed').map(f => `<tr><td>${esc(f.label)}</td><td>${esc(r.data[f.k] || '—')}</td></tr>`).join('')}</table>${edits(r)}</div>`).join('') || '<p class="dim">None in this period.</p>'}</section>`;
  const skips = current.filter(r => r.kind === 'skip' && new Date(r.at) >= start && new Date(r.at) <= end);
  if (skips.length) html += `<section><h2>Checks not done (with reason)</h2><table class="grid"><tr><th>Date</th><th>Check</th><th>Reason</th><th>Initials</th></tr>${skips.map(r => `<tr><td>${esc(nzTime(r.at))}</td><td>${esc(r.data.title)}</td><td>${esc(r.data.reason)}</td><td>${esc(r.initials || '')}</td></tr>`).join('')}</table></section>`;
  const voids = changed.filter(r => r.void);
  if (voids.length) html += `<section><h2>Entries marked not valid</h2><table class="grid"><tr><th>Entered</th><th>Type</th><th>Reason</th></tr>${voids.map(r => `<tr><td>${esc(nzTime(r.created_at))}</td><td>${esc(r.kind)}${r.section ? ' · ' + esc(r.section) : ''}</td><td>${esc(r.reason)}</td></tr>`).join('')}</table></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Blair's Biltong food safety records ${esc(from)} to ${esc(to)}</title>
<style>
body{font:13px/1.45 Helvetica,Arial,sans-serif;color:#1a1410;margin:0;padding:24px;max-width:900px;margin:auto}
header{border-bottom:3px solid #b9873c;padding-bottom:12px;margin-bottom:18px}
h1{font-size:20px;margin:0 0 4px;letter-spacing:.02em}h2{font-size:15px;margin:26px 0 8px;padding:6px 10px;background:#241b13;color:#f7f1e4;border-radius:4px}
h3{font-size:13px;margin:14px 0 4px}.ccp{font-size:10px;background:#f5e0db;color:#9a3324;padding:2px 6px;border-radius:8px;vertical-align:1px}
table{width:100%;border-collapse:collapse;margin:4px 0}td,th{border:1px solid #d9cfbd;padding:4px 7px;text-align:left;vertical-align:top}
th{background:#f2ece1;font-size:11px;text-transform:uppercase;letter-spacing:.06em}td:first-child{width:42%}table.grid td:first-child{width:auto}
.meta{margin:2px 0 4px;color:#5a4a38}.ok{color:#3d6a37;font-weight:bold}.bad,.no{color:#9a3324;font-weight:bold}.warn{color:#9a6114;font-weight:bold}.dim{color:#8a7a66}
.edit{margin:6px 0;padding:6px 8px;background:#fdf6e9;border-left:3px solid #b9873c;font-size:12px}.old{color:#6b5b49;text-decoration:line-through;margin-top:3px;word-break:break-all}
.sec{break-inside:avoid}section.batch{break-before:page}section.batch:first-of-type{break-before:auto}
.bar{position:sticky;top:0;background:#fff;padding:10px 0;display:flex;gap:8px}button{font:bold 13px Helvetica;padding:10px 16px;border:0;border-radius:6px;background:#b9873c;color:#150e07}
@media print{.bar{display:none}body{padding:0}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<header><h1>Blair's Biltong · Food safety records</h1>
<div>${esc(nzDay(start))} to ${esc(nzDay(end))} · Food Control Plan (My Food Plan) · Records and Forms v2.0, kept digitally</div>
<div class="dim">Printed ${esc(nzTime(new Date()))}. Records are time-stamped when entered. Corrections keep the earlier version, with the reason and who made it.</div></header>
${html}
</body></html>`;
}

/** Everything, for your own backup. */
export async function exportAll() {
  const { rows: records } = await q(`SELECT * FROM fs_records ORDER BY id`);
  const { rows: batches } = await q(`SELECT * FROM batches ORDER BY id`);
  const { rows: movements } = await q(`SELECT * FROM movements ORDER BY id`);
  const { rows: supplies } = await q(`SELECT * FROM supplies ORDER BY id`);
  const { rows: supplyMoves } = await q(`SELECT * FROM supply_moves ORDER BY id`);
  return { exported: new Date().toISOString(), records, batches, movements, supplies, supplyMoves };
}

export { sliceResults };
