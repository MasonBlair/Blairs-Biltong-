/**
 * Food safety records — the digital version of the Records and Forms v2.0
 * pack (batch record, chiller, cleaning, calibration, corrective actions).
 *
 * One schema below drives three things, so they can never disagree:
 *   1. the forms in the app,
 *   2. the pass / fail checks against your critical limits (done here, on
 *      the server, so a record can't be saved as "pass" when it isn't),
 *   3. the printout for your verifier.
 *
 * Records are never overwritten. Changing one saves a new version with a
 * reason and keeps the old one; deleting one marks it void with a reason.
 * That's the digital version of "one line through it, initial beside it".
 */

/* ------------------------------------------------------------------ settings */
export const FS_DEFAULTS = {
  initials: '',
  units: ['Chiller'],                     // fridges / chillers you log
  limits: {
    chillerMax: 5,                        // °C, meat storage and marinating (CCP 1 support)
    thickMax: 17,                         // mm, thickest slice (15 ± 2)
    saltMinPerKg: 30,                     // g/kg, CCP 1 critical limit (recipe target 40)
    marinateMinH: 10,                     // hours at ≤ 5 °C, CCP 1
    awMax: 0.85,                          // CCP 2
    releaseLossPct: null                  // % weight loss reference from the Water Activity Setup Record
  },
  // Per kg of trimmed raw meat. Vinegar is weighed (g); Lea & Perrins measured (mL).
  // Spice blend = coriander + pepper (60:40), plus chilli for Dry Heat once set.
  recipe: { salt: 40, vinegar: 100, worcestershire: 60, coriander: 40, pepper: 26.7, chilli: null }
};

export const FS_REMINDER_DEFAULTS = [
  { id: 'chill-am', title: 'Fridge temperature check', kind: 'chiller', freq: 'daily', days: [1, 2, 3, 4, 5, 6, 7], time: '08:00', enabled: true },
  { id: 'chill-pm', title: 'Fridge temperature check (evening)', kind: 'chiller', freq: 'daily', days: [1, 2, 3, 4, 5, 6, 7], time: '17:00', enabled: false },
  { id: 'clean-chiller', title: 'Weekly chiller clean', kind: 'cleaning', freq: 'weekly', days: [1], time: '09:00', enabled: true },
  { id: 'calib-month', title: 'Monthly calibration: thermometers and dryer', kind: 'calibration', freq: 'monthly', monthDay: 1, time: '09:00', enabled: true }
];

/* ------------------------------------------------------------------ schema */
// Field types: text, area, num, tick (a box that should be ticked), choice,
// time, info (worked out for you), slices (the 10-slice table), checklist.
// `limit: { max: 'chillerMax' }` points at FS_DEFAULTS.limits.
export const CLEAN_AREAS = [
  'Benches, boards, knives, slicer, containers',
  'Dehydrator racks, hooks, interior',
  'Drying space',
  'Chiller',
  'Scales',
  'Floors and general area'
];

export const CALIBRATION = [
  { id: 'scale-ref', label: 'Digital scales', check: 'Known reference mass', unit: 'g', reference: 1000, tol: { pct: 1 }, freq: 'Before each production session' },
  { id: 'scale-cert', label: 'Digital scales', check: 'Certified test weights', unit: 'g', reference: 1000, tol: { pct: 1 }, freq: 'Annually' },
  { id: 'chiller-thermo', label: 'Chiller thermometer', check: 'Ice point (crushed ice + water)', unit: '°C', reference: 0, tol: { abs: 1 }, freq: 'Monthly' },
  { id: 'probe-thermo', label: 'Probe thermometer', check: 'Ice point (crushed ice + water)', unit: '°C', reference: 0, tol: { abs: 1 }, freq: 'Monthly' },
  { id: 'dryer-display', label: 'Dehydrator display', check: 'Against calibrated probe in chamber', unit: '°C', reference: null, tol: { abs: 2 }, freq: 'Monthly' }
];

export const BATCH_SECTIONS = [
  { key: 'receiving', no: 1, title: 'Receiving', day: 'Marinating day', fields: [
    { k: 'supplier', type: 'text', label: 'Supplier', remember: true, placeholder: 'Kaan’s Catering Supplies' },
    { k: 'estNo', type: 'text', label: 'Establishment No.', remember: true, placeholder: 'ME123' },
    { k: 'docket', type: 'text', label: 'Invoice / docket no.' },
    { k: 'cut', type: 'choice', label: 'Cut', options: ['Silverside', 'Topside', 'Both'] },
    { k: 'frozen', type: 'choice', label: 'Fresh or frozen', options: ['Fresh', 'Previously frozen'] },
    { k: 'weightKg', type: 'num', label: 'Weight received', unit: 'kg', dec: true },
    { k: 'packagingOk', type: 'tick', label: 'Packaging intact, no off odour' },
    { k: 'arrivalC', type: 'num', label: 'Temperature on arrival', unit: '°C', dec: true, limit: { max: 'chillerMax' } },
    { k: 'chillerTime', type: 'time', label: 'Into chiller at' },
    { k: 'chillerC', type: 'num', label: 'Chiller temperature', unit: '°C', dec: true, limit: { max: 'chillerMax' } }
  ] },
  { key: 'slicing', no: 2, title: 'Trimming and slicing', day: 'Marinating day', fields: [
    { k: 'sanitised', type: 'tick', label: 'Surfaces, knives and boards sanitised' },
    { k: 'hands', type: 'tick', label: 'Hands washed' },
    { k: 'samples', type: 'tick', label: 'Sample slices numbered and weighed (step 6)' },
    { k: 'trimmedKg', type: 'num', label: 'Trimmed weight', unit: 'kg', dec: true, req: true },
    { k: 'thickestMm', type: 'num', label: 'Thickest slice', unit: 'mm', dec: true, limit: { max: 'thickMax' } }
  ] },
  { key: 'marinate_start', no: 3, title: 'Marinating: start', ccp: 'CCP 1', day: 'Marinating day', fields: [
    { k: 'targets', type: 'info', label: 'Targets (trimmed weight × recipe)' },
    { k: 'saltG', type: 'num', label: 'Salt weighed', unit: 'g', req: true },
    { k: 'vinegarG', type: 'num', label: 'Malt vinegar weighed', unit: 'g' },
    { k: 'worcMl', type: 'num', label: 'Lea & Perrins measured', unit: 'mL' },
    { k: 'submerged', type: 'tick', label: 'Meat fully submerged', critical: true },
    { k: 'chillerC', type: 'num', label: 'Chiller temperature at start', unit: '°C', dec: true, limit: { max: 'chillerMax' }, req: true }
  ] },
  { key: 'marinate_end', no: 4, title: 'Marinating: finish', ccp: 'CCP 1', day: 'Next morning', fields: [
    { k: 'hours', type: 'info', label: 'Total marinating time' },
    { k: 'chillerC', type: 'num', label: 'Chiller temperature at finish', unit: '°C', dec: true, limit: { max: 'chillerMax' }, req: true },
    { k: 'stillSubmerged', type: 'tick', label: 'Meat still fully submerged', critical: true }
  ] },
  { key: 'spice', no: 5, title: 'Spice application', day: 'Next morning', note: 'Not a critical limit. Tracks how much spice actually lands on the meat.', fields: [
    { k: 'blendLot', type: 'text', label: 'Blend lot / date' },
    { k: 'seasonedKg', type: 'num', label: 'Meat seasoned', unit: 'kg', dec: true },
    { k: 'tubBefore', type: 'num', label: 'Spice tub before', unit: 'g' },
    { k: 'tubAfter', type: 'num', label: 'Spice tub after', unit: 'g' },
    { k: 'fallOff', type: 'num', label: 'Fall-off swept up', unit: 'g' },
    { k: 'perKg', type: 'info', label: 'Spice on meat' }
  ] },
  { key: 'drying_start', no: 6, title: 'Drying: start', ccp: 'CCP 2', day: 'Next morning', fields: [
    { k: 'ccp1', type: 'tick', label: 'All CCP 1 limits met (if not, do not dry)', critical: true },
    { k: 'meatOk', type: 'tick', label: 'Marinated meat OK: no off odour, slime or discolouration', critical: true },
    { k: 'dryerClean', type: 'tick', label: 'Dryer and drying space cleaned and sanitised' },
    { k: 'samplesIn', type: 'tick', label: 'Sample slices loaded and identifiable' },
    { k: 'hung', type: 'tick', label: 'Hung, not touching' },
    { k: 'settingC', type: 'num', label: 'Dryer setting', unit: '°C' }
  ] },
  { key: 'drying_end', no: 7, title: 'Drying: finish', ccp: 'CCP 2', day: 'Drying', fields: [
    { k: 'hours', type: 'info', label: 'Total drying time (information only)' },
    { k: 'midCheck', type: 'area', label: 'Mid-cycle check (what you saw)' }
  ] },
  { key: 'slices', no: 8, title: 'Sample slices and water activity', ccp: 'CCP 2 limit', day: 'Slicing and drying', note: '10 slices including the thickest. Raw weight at slicing, before marinating. Loss % = (raw − dry) ÷ raw × 100.', fields: [
    { k: 'rows', type: 'slices', label: 'Sample slices' },
    { k: 'method', type: 'choice', label: 'Water activity method', options: ['Weight loss', 'Meter', 'Lab'] },
    { k: 'aw', type: 'num', label: 'aw result (meter or lab)', dec: true, limit: { max: 'awMax', strict: true } },
    { k: 'labRef', type: 'text', label: 'Lab report / meter reference' }
  ] },
  { key: 'post', no: 9, title: 'Post-drying assessment', day: 'Packing day', fields: [
    { k: 'noMould', type: 'tick', label: 'No visible mould', critical: true },
    { k: 'noMoisture', type: 'tick', label: 'No surface moisture', critical: true },
    { k: 'noCase', type: 'tick', label: 'No case hardening (thick slice cut open)', critical: true },
    { k: 'finalKg', type: 'num', label: 'Final batch weight', unit: 'kg', dec: true },
    { k: 'yield', type: 'info', label: 'Yield against trimmed weight' }
  ] },
  { key: 'packing', no: 10, title: 'Packaging and labelling', day: 'Packing day', fields: [
    { k: 'hands', type: 'tick', label: 'Hands washed' },
    { k: 'bench', type: 'tick', label: 'Bench sanitised' },
    { k: 'gloves', type: 'tick', label: 'Gloves on' },
    { k: 'bags', type: 'tick', label: 'Bags clean and dry' },
    { k: 'scale', type: 'tick', label: 'Scale checked against known weight' },
    { k: 'labelVersion', type: 'text', label: 'Label version', remember: true, placeholder: 'v2.9' },
    { k: 'labelChecked', type: 'tick', label: 'Label checked against approved copy', critical: true },
    { k: 'batchNo', type: 'tick', label: 'Batch number on every pack', critical: true }
  ] },
  { key: 'release', no: 11, title: 'Release', day: 'Packing day', fields: [] }
];

export const LOG_FORMS = {
  chiller: { title: 'Fridge temperature', fields: [
    { k: 'unit', type: 'choice', label: 'Fridge', options: 'units' },
    { k: 'readingC', type: 'num', label: 'Reading', unit: '°C', dec: true, limit: { max: 'chillerMax' }, req: true, big: true },
    { k: 'action', type: 'area', label: 'Action taken (if over the limit)', failOnly: true }
  ] },
  cleaning: { title: 'Cleaning and sanitising', fields: [
    { k: 'areas', type: 'checklist', label: 'What you cleaned', options: CLEAN_AREAS, cols: ['Cleaned', 'Sanitised'] },
    { k: 'product', type: 'text', label: 'Product used', remember: true, placeholder: 'Sanitiser name' }
  ] },
  calibration: { title: 'Calibration check', fields: [
    { k: 'equipment', type: 'choice', label: 'Equipment and check', options: 'calibration', req: true },
    { k: 'reference', type: 'num', label: 'Reference', dec: true, req: true },
    { k: 'reading', type: 'num', label: 'Reading', dec: true, req: true },
    { k: 'action', type: 'area', label: 'Action taken (if out of tolerance)', failOnly: true }
  ] },
  corrective: { title: 'Corrective action', fields: [
    { k: 'what', type: 'area', label: 'What happened', req: true },
    { k: 'limit', type: 'text', label: 'Which limit or control was affected' },
    { k: 'found', type: 'text', label: 'How it was found' },
    { k: 'immediate', type: 'area', label: 'Immediate action taken', req: true },
    { k: 'affected', type: 'text', label: 'Product affected: batches, quantities' },
    { k: 'decision', type: 'choice', label: 'Decision on that product', options: ['Released', 'Reworked', 'Held', 'Discarded', 'Recalled'] },
    { k: 'reasoning', type: 'area', label: 'Reasoning for the decision' },
    { k: 'rootCause', type: 'area', label: 'Root cause' },
    { k: 'prevention', type: 'area', label: 'What was changed to prevent it happening again' },
    { k: 'closed', type: 'tick', label: 'Closed: product decided and cause dealt with', optional: true }
  ] }
};

/** Spice blend per kg for a flavour. */
export function spicePerKg(recipe, flavour) {
  return (recipe.coriander || 0) + (recipe.pepper || 0) + (flavour === 'dryheat' && recipe.chilli ? recipe.chilli : 0);
}

/* ------------------------------------------------------------------ checks */
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = n => Math.round(n * 10) / 10;

function limitOf(f, limits) {
  if (!f.limit) return null;
  const k = f.limit.max ?? f.limit.min;
  const v = limits[k];
  return v == null ? null : { max: f.limit.max ? v : null, min: f.limit.min ? v : null, strict: !!f.limit.strict };
}

/** Generic checks: numbers against limits, ticks that should be ticked, required fields. */
function checkFields(fields, data, limits) {
  const fails = [], missing = [], notes = [];
  for (const f of fields) {
    const v = data[f.k];
    if (f.type === 'num') {
      const n = num(v);
      if (n == null) { if (f.req) missing.push(f.label); continue; }
      const L = limitOf(f, limits);
      if (L?.max != null && (L.strict ? n >= L.max : n > L.max)) fails.push(`${f.label} ${n}${f.unit ? ' ' + f.unit : ''} (limit ${L.strict ? 'below' : '≤'} ${L.max})`);
      if (L?.min != null && n < L.min) fails.push(`${f.label} ${n}${f.unit ? ' ' + f.unit : ''} (limit ≥ ${L.min})`);
    } else if (f.type === 'tick') {
      if (f.optional) continue;
      if (v !== true) (f.critical ? fails : notes).push(`${f.label}: not done`);
    } else if (f.req && (v == null || String(v).trim() === '')) missing.push(f.label);
  }
  return { fails, missing, notes };
}

/** Slices: loss % for each, and which ones fall below the release threshold. */
export function sliceResults(rows, limits) {
  const out = (rows || []).map((r, i) => {
    const raw = num(r.raw), dry = num(r.dry);
    const loss = raw && dry != null && raw > 0 ? r1((raw - dry) / raw * 100) : null;
    const pass = loss == null || limits.releaseLossPct == null ? null : loss >= limits.releaseLossPct;
    return { no: i + 1, thick: num(r.thick), raw, dry, loss, pass };
  });
  return out;
}

/**
 * Work out pass / fail for one record. `ctx.sections` holds the batch's
 * other current sections (for salt per kg, hours, yield).
 */
export function evaluate(kind, section, data, at, settings, ctx = {}) {
  const limits = { ...FS_DEFAULTS.limits, ...(settings.limits || {}) };
  const recipe = { ...FS_DEFAULTS.recipe, ...(settings.recipe || {}) };
  const derived = {};
  let fields;
  if (kind === 'batch') fields = BATCH_SECTIONS.find(s => s.key === section)?.fields;
  else fields = LOG_FORMS[kind]?.fields;
  if (!fields) throw new Error('Unknown record type');

  const { fails, missing, notes } = checkFields(fields, data, limits);
  const S = ctx.sections || {};
  const kg = num(S.slicing?.data?.trimmedKg) ?? num(ctx.rawKg);

  if (kind === 'batch') {
    if (section === 'marinate_start' && kg) {
      derived.targets = `Salt ${Math.round(kg * recipe.salt)} g · vinegar ${Math.round(kg * recipe.vinegar)} g · Lea & Perrins ${Math.round(kg * recipe.worcestershire)} mL (${r1(kg)} kg)`;
      const salt = num(data.saltG);
      if (salt != null) {
        derived.saltPerKg = r1(salt / kg);
        if (derived.saltPerKg < limits.saltMinPerKg) fails.push(`Salt ${derived.saltPerKg} g/kg (critical limit ≥ ${limits.saltMinPerKg} g/kg)`);
      }
    }
    if (section === 'marinate_end' && S.marinate_start?.at) {
      const h = r1((new Date(at) - new Date(S.marinate_start.at)) / 3.6e6);
      derived.hours = `${h} hours`;
      if (h < limits.marinateMinH) fails.push(`Marinated ${h} h (critical limit ≥ ${limits.marinateMinH} h)`);
    }
    if (section === 'spice') {
      const net = (num(data.tubBefore) ?? 0) - (num(data.tubAfter) ?? 0) - (num(data.fallOff) ?? 0);
      const skg = num(data.seasonedKg) ?? kg;
      if (num(data.tubBefore) != null && num(data.tubAfter) != null && skg) derived.perKg = `${Math.round(net)} g net · ${r1(net / skg)} g/kg (target ${r1(spicePerKg(recipe, ctx.flavour))})`;
    }
    if (section === 'drying_end' && S.drying_start?.at) derived.hours = `${r1((new Date(at) - new Date(S.drying_start.at)) / 3.6e6)} hours`;
    if (section === 'slices') {
      const rows = sliceResults(data.rows, limits);
      derived.slices = rows;
      const done = rows.filter(r => r.loss != null);
      if (data.method === 'Weight loss' || !data.method) {
        if (limits.releaseLossPct == null && done.length) notes.push('No release threshold set yet (Water Activity Setup Record)');
        rows.filter(r => r.pass === false).forEach(r => fails.push(`Slice ${r.no}: ${r.loss}% loss (needs ≥ ${limits.releaseLossPct}%)`));
        if (data.method === 'Weight loss' && done.length < 10) missing.push(`${10 - done.length} more slice${done.length === 9 ? '' : 's'} with dry weight`);
      } else if (num(data.aw) == null) missing.push('aw result');
    }
    if (section === 'post' && kg && num(data.finalKg)) derived.yield = `${r1(num(data.finalKg) / kg * 100)}% of trimmed weight`;
  }

  if (kind === 'calibration') {
    const eq = CALIBRATION.find(c => c.id === data.equipment);
    const ref = num(data.reference), rd = num(data.reading);
    if (eq && ref != null && rd != null) {
      const tol = eq.tol.pct ? Math.abs(ref) * eq.tol.pct / 100 : eq.tol.abs;
      derived.diff = r1(rd - ref);
      derived.tolerance = `± ${r1(tol)} ${eq.unit}`;
      if (Math.abs(rd - ref) > tol + 1e-9) fails.push(`${eq.label}: ${rd} vs ${ref} ${eq.unit} (tolerance ${derived.tolerance})`);
    }
  }
  if (kind === 'cleaning') {
    const ticked = Object.values(data.areas || {}).filter(a => a?.cleaned || a?.sanitised).length;
    if (!ticked) missing.push('Tick at least one area');
  }
  if (['chiller', 'calibration'].includes(kind) && fails.length && !String(data.action || '').trim()) missing.push('Action taken');

  // pass: true = all good, false = a limit failed, null = not finished yet.
  const pass = kind === 'corrective' ? null : fails.length ? false : missing.length ? null : true;
  return { pass, fails, notes, missing, derived };
}

/* ------------------------------------------------------------------ reminders */
/** Offset of NZ time from UTC (minutes) at a given instant. */
function nzOffset(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}
/** NZ wall-clock date + time → real instant. */
export function nzToDate(ymd, hm) {
  const [y, m, d] = ymd.split('-').map(Number), [hh, mm] = hm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  return new Date(guess.getTime() - nzOffset(guess) * 60000);
}
export function nzParts(d = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(d);
  const wd = (new Date(ymd + 'T12:00:00Z').getUTCDay() || 7);   // 1 = Mon … 7 = Sun
  return { ymd, wd };
}
const addDaysYmd = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** The latest time this reminder should have fired, or null if not in the window. */
function lastSlot(r, now) {
  const { ymd } = nzParts(now);
  const look = r.freq === 'monthly' ? 31 : r.freq === 'weekly' ? 7 : 0;
  for (let i = 0; i <= look; i++) {
    const day = addDaysYmd(ymd, -i);
    const wd = new Date(day + 'T12:00:00Z').getUTCDay() || 7;
    const dom = Number(day.slice(8));
    const ok = r.freq === 'monthly' ? dom === Number(r.monthDay || 1) : (r.days || []).includes(wd);
    if (!ok) continue;
    const at = nzToDate(day, r.time || '09:00');
    if (at <= now) return { at, day };
  }
  return null;
}

/** Which reminders are due right now, given recent records. */
export function dueReminders(reminders, records, now = new Date()) {
  const out = [];
  for (const r of reminders || []) {
    if (!r.enabled) continue;
    const slot = lastSlot(r, now);
    if (!slot) continue;
    // Counts if logged from 3 hours before the reminder (daily) or any time that day (weekly/monthly).
    const from = r.freq === 'daily' ? new Date(slot.at.getTime() - 3 * 3.6e6) : nzToDate(slot.day, '00:00');
    const done = records.some(x => new Date(x.at) >= from &&
      ((x.kind === r.kind && (r.kind !== 'cleaning' || !r.area || x.data?.areas?.[r.area])) ||
       (x.kind === 'skip' && x.data?.reminderId === r.id)));
    if (!done) out.push({ id: r.id, title: r.title, kind: r.kind, since: slot.at.toISOString(), late: Math.round((now - slot.at) / 60000) });
  }
  return out;
}

/* ------------------------------------------------------------------ batch status */
export function batchProgress(sectionsByKey) {
  const keys = BATCH_SECTIONS.map(s => s.key);
  const done = keys.filter(k => sectionsByKey[k]);
  const failed = keys.filter(k => sectionsByKey[k]?.pass === false);
  return { done: done.length, total: keys.length, failed, released: Boolean(sectionsByKey.release), next: keys.find(k => !sectionsByKey[k]) || null };
}

/** What has to be true before a batch can be released for sale. */
export function releaseChecks(S, openCorrective) {
  const ok = k => S[k]?.pass === true;
  return [
    { label: 'Receiving and slicing recorded', ok: ok('receiving') && ok('slicing') },
    { label: 'CCP 1 limits met (salt, submersion, ≤ 5 °C, ≥ 10 h)', ok: ok('marinate_start') && ok('marinate_end') },
    { label: 'Drying recorded', ok: ok('drying_start') && ok('drying_end') },
    { label: 'Water activity below 0.85 (CCP 2)', ok: ok('slices') },
    { label: 'Post-drying assessment passed', ok: ok('post') },
    { label: 'Packaging and labelling checked', ok: ok('packing') },
    { label: 'Corrective actions closed', ok: openCorrective === 0 }
  ];
}
