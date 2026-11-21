import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const r = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const SECRET = process.env.ADMIN_PASSWORD || '';
const GRACE = 1500;          // ms of network slack on every timer
const WORK_MAX = 600000;     // max characters of a work photo (base64 JPEG)
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const L = i => String.fromCharCode(65 + i);

/* ---------------- admin auth ---------------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = e => crypto.createHmac('sha256', SECRET).update(String(e)).digest('hex');
const mkToken = () => { const e = Date.now() + 12 * 3600e3; return e + '.' + sign(e); };
const isAdmin = t => {
  try {
    const [e, s] = String(t || '').split('.');
    return !!SECRET && Number(e) > Date.now() && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(e)));
  } catch { return false; }
};
const needAdmin = b => { if (!isAdmin(b.token)) throw err('Not authorised', 401); };

/* login attempt limit: 5 wrong passwords per IP, 60 in total, per 15 minutes */
async function limited(ip) {
  const [a, g] = await Promise.all([r.get('rl:' + ip), r.get('rl:all')]);
  if (+a >= 5 || +g >= 60) throw err('Too many wrong passwords. Try again in 15 minutes.', 429);
}
async function failed(ip) {
  for (const k of ['rl:' + ip, 'rl:all']) { const n = await r.incr(k); if (n === 1) await r.expire(k, 900); }
}

/* ---------------- seeded randomness ---------------- */
function mkRng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h = h || 1;
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  for (let i = 0; i < 8; i++) rnd();
  return rnd;
}
function perm(n, seed) {
  const rnd = mkRng(seed), a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------------- safe formula evaluator (no eval) ---------------- */
const D = Math.PI / 180;
const FN = {
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sin: x => Math.sin(x * D), cos: x => Math.cos(x * D), tan: x => Math.tan(x * D),
  asin: x => Math.asin(x) / D, acos: x => Math.acos(x) / D, atan: x => Math.atan(x) / D, atan2: (y, x) => Math.atan2(y, x) / D,
  sinr: Math.sin, cosr: Math.cos, tanr: Math.tan,
};
const RESERVED = new Set(['pi', 'e', 'ans', ...Object.keys(FN)]);
function evalF(src, vars) {
  const s = String(src).replace(/\*\*/g, '^');
  if (s.length > 300) throw new Error('long');
  const T = s.match(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[()+\-*/^,]|\S/g) || [];
  let p = 0;
  const peek = () => T[p], nxt = () => T[p++];
  function atom() {
    const t = nxt();
    if (t === undefined) throw new Error('end');
    if (t === '(') { const v = expr(); if (nxt() !== ')') throw new Error(')'); return v; }
    if (/^(?:\d|\.\d)/.test(t)) return parseFloat(t);
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        nxt(); const args = [];
        if (peek() !== ')') { do { args.push(expr()); } while (peek() === ',' && nxt()); }
        if (nxt() !== ')') throw new Error(')');
        if (!Object.hasOwn(FN, t)) throw new Error('fn');
        return FN[t](...args);
      }
      if (Object.hasOwn(vars, t)) return vars[t];
      if (t === 'pi') return Math.PI;
      if (t === 'e') return Math.E;
    }
    throw new Error('token');
  }
  function pow() { const b = atom(); if (peek() === '^') { nxt(); return Math.pow(b, unary()); } return b; }
  function unary() { if (peek() === '-') { nxt(); return -unary(); } if (peek() === '+') { nxt(); return unary(); } return pow(); }
  function term() { let v = unary(); while (peek() === '*' || peek() === '/') { const o = nxt(), x = unary(); v = o === '*' ? v * x : v / x; } return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = nxt(), x = term(); v = o === '+' ? v + x : v - x; } return v; }
  const v = expr();
  if (p < T.length || !isFinite(v)) throw new Error('bad');
  return v;
}

/* ---------------- text, numbers, settings ---------------- */
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
const nu = u => String(u || '').replace(/\s+/g, '').replace(/[\^·*]/g, '').replace(/²/g, '2').replace(/³/g, '3');
const pf = v => parseFloat(String(v ?? '').replace(',', '.'));
const fmt = x => String(+Number(x).toPrecision(6));
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? fmt(vars[k]) : m));
const decs = x => Math.min(6, (String(x).split('.')[1] || '').length);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const DEFS = {
  shuffleQ: true, shuffleC: true, copyBlock: true, fsTrack: true, showScore: false, calc: false, units: false, multi: true, neg: 0,
  sheet: '', opens: 0, closes: 0, roster: [], school: 'UNIVERSITY OF THE EAST', followUps: 0, spot: 0, spotMins: 15, sheetUrl: '', sheetKey: '',
};
const SHEET_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/|macros\/)s\/[A-Za-z0-9_-]+\/exec$/;
const opt = ex => ({ ...DEFS, ...(ex.set || {}) });
const isOpen = ex => { const o = opt(ex), n = Date.now(); return ex.status === 'open' && (!o.opens || n >= o.opens) && (!o.closes || n <= o.closes); };
const mkSet = s => {
  s = s || {};
  const url = String(s.sheetUrl || '').trim();
  if (url && !SHEET_RE.test(url)) throw err('The Google Sheets link must be the web app URL that ends in /exec');
  return {
    shuffleQ: !!s.shuffleQ, shuffleC: !!s.shuffleC, copyBlock: !!s.copyBlock, fsTrack: !!s.fsTrack, showScore: !!s.showScore,
    calc: !!s.calc, units: !!s.units, multi: !!s.multi, neg: clamp(+s.neg || 0, 0, 100),
    sheet: String(s.sheet || '').slice(0, 3000), opens: +s.opens || 0, closes: +s.closes || 0,
    roster: (Array.isArray(s.roster) ? s.roster : []).map(norm).filter(Boolean).slice(0, 2000),
    school: String(s.school ?? DEFS.school).slice(0, 60),
    followUps: clamp(Math.floor(+s.followUps || 0), 0, 3), spot: clamp(Math.floor(+s.spot || 0), 0, 3), spotMins: clamp(Math.floor(+s.spotMins || 15), 1, 1440),
    sheetUrl: url, sheetKey: String(s.sheetKey || '').slice(0, 100),
  };
};
const aKey = sid => 'att:' + norm(sid);
const wKey = (sid, qi) => 'work:' + norm(sid) + ':' + qi;

/* ---------------- per-student numbers and answers ---------------- */
function genVars(q, seed, qi) {
  const out = {};
  if (!q.vars || !q.vars.length) return out;
  const rnd = mkRng(seed + '|' + qi + '|v');
  for (const v of q.vars) {
    const n = Math.floor((v.max - v.min) / v.step + 1e-9) + 1;
    out[v.n] = +(v.min + Math.floor(rnd() * n) * v.step).toFixed(Math.max(decs(v.step), decs(v.min)));
  }
  return out;
}
function expectNum(k, vars) {
  if (k.f) { try { return [+evalF(k.f, vars).toPrecision(10)]; } catch { return []; } }
  return k.v || [];
}
const ansVal = (q, k, vars) => {
  if (q.type === 'num') { const e = expectNum(k, vars); return e.length ? fmt(e[0]) + (k.u ? ' ' + k.u : '') : ''; }
  return q.c[k.a] ?? '';
};
const close = (x, y, tolPct) => Math.abs(x - y) <= Math.abs(y) * tolPct / 100 + 1e-9;
const corr = (q, k, a, o, vars) => {
  if (!a) return false;
  if (q.type === 'num') {
    const x = pf(a.v); if (!isFinite(x)) return false;
    const ev = expectNum(k, vars), Ls = o.multi ? ev : ev.slice(0, 1), t = k.tol || 0;
    return Ls.some(n => close(x, n, t)) && (!o.units || !k.u || nu(a.u) === nu(k.u));
  }
  return a.s >= 0 && a.s === k.a;
};
const att = (q, a) => !!a && (q.type === 'num' ? isFinite(pf(a.v)) : a.s >= 0);
const earn = (q, k, a, o, vars) => { const p = q.pts ?? 1; return corr(q, k, a, o, vars) ? p : att(q, a) ? -p * (o.neg || 0) / 100 : 0; };
const score = (a, K, ex) => {
  const o = opt(ex); let s = 0;
  ex.questions.forEach((q, i) => { s += earn(q, K[i] || {}, a.ans && a.ans[i], o, genVars(q, a.seed, i)); });
  return Math.max(0, Math.round(s * 100) / 100);
};
const maxPts = ex => ex.questions.reduce((s, q) => s + (q.pts ?? 1), 0);
const rc = a => crypto.createHash('sha256').update(a.token + '|' + (a.finished || '')).digest('hex').slice(0, 8).toUpperCase() + '-' + (a.finished ? a.finished.toString(36).toUpperCase().slice(-4) : '');

/* ---------------- validating one question (used by save and preview) ---------------- */
function cleanQ(q, i) {
  const num = q.type === 'num', E = m => err('Question ' + (i + 1) + ': ' + m);
  const item = {
    q: String(q.q || ''), type: num ? 'num' : 'mc', c: num ? [] : (Array.isArray(q.c) ? q.c : []).map(String),
    t: Math.max(5, +q.t || 30), pts: Math.max(0, +q.pts >= 0 ? +q.pts : 1),
  };
  const key = {};
  if (!item.q.trim()) throw E('type the question.');
  if (num) {
    const f = String(q.f || '').trim();
    const vars = (Array.isArray(q.vars) ? q.vars : []).slice(0, 6).map(v => ({ n: String(v.n || '').trim(), min: +v.min, max: +v.max, step: +v.step }));
    if (f) {
      const seen = new Set();
      for (const v of vars) {
        if (!/^[A-Za-z_]\w{0,9}$/.test(v.n) || RESERVED.has(v.n) || seen.has(v.n)) throw E('variable name "' + v.n + '" is not allowed. Use names like a, t, m1 (not e, pi, ans or a function name) and no repeats.');
        seen.add(v.n);
        if (![v.min, v.max, v.step].every(isFinite) || v.step <= 0 || v.max < v.min || (v.max - v.min) / v.step > 1e5) throw E('check the range of ' + v.n + ' (min, max, and a step above 0).');
      }
      item.vars = vars;
      for (let k = 0; k < 100; k++) {
        try { evalF(f, genVars(item, 'chk' + k, i)); }
        catch { throw E('the formula cannot be calculated for every possible set of numbers (check for division by zero). Use + - * / ^ ( ), your variable names, and functions like sqrt, sin, cos, ln.'); }
      }
      key.f = f;
    } else if (vars.length) throw E('add a formula for the answer.');
    key.v = String(q.v ?? '').split(',').map(parseFloat).filter(isFinite);
    if (!f && !key.v.length) throw E('add at least one accepted answer.');
    key.tol = Math.max(0, +q.tol || 0); key.u = String(q.u || '').trim();
  } else {
    if (item.c.length < 2 || item.c.some(c => !c.trim())) throw E('fill in every choice.');
    key.a = clamp(+q.a || 0, 0, item.c.length - 1);
  }
  const fu = q.fu;
  if (fu && String(fu.q || '').trim()) {
    const c = (Array.isArray(fu.c) ? fu.c : []).map(String);
    if (c.length < 2 || c.some(x => !x.trim())) throw E('fill in every follow-up choice.');
    item.fu = { q: String(fu.q), c, t: Math.max(5, +fu.t || 25) };
    key.fa = clamp(+fu.a || 0, 0, c.length - 1);
  }
  return { item, key };
}

/* ---------------- an attempt is a list of items: main questions, then follow-ups ---------------- */
const items = a => a.order.map(qi => ({ qi, f: 0 })).concat((a.fu || []).map(qi => ({ qi, f: 1 })));
const lockIf = (a, ex) => {
  if (a.status === 'in_progress' && ex.maxLeaves > 0 && a.leaves >= ex.maxLeaves) { a.status = 'locked'; a.finished = Date.now(); }
};

/* called whenever a.cur moved: choose follow-ups once the main part ends, then finish */
async function settle(a, ex) {
  const o = opt(ex);
  if (a.cur >= a.order.length && !a.fuSet) {
    a.fuSet = true;
    if (o.followUps > 0) {
      const K = (await r.get('key')) || [];
      const cands = a.order.filter(qi => ex.questions[qi].fu && corr(ex.questions[qi], K[qi] || {}, a.ans[qi], o, genVars(ex.questions[qi], a.seed, qi)));
      a.fu = perm(cands.length, a.seed + '|fu').slice(0, o.followUps).map(i => cands[i]);
    }
  }
  if (a.status === 'in_progress' && a.cur >= items(a).length) {
    a.status = 'done'; a.finished = Date.now();
    if (o.spot > 0) {
      const nums = a.order.filter(qi => ex.questions[qi].type === 'num'), pool = nums.length ? nums : a.order;
      a.workReq = perm(pool.length, a.seed + '|wk').slice(0, o.spot).map(i => pool[i]);
      a.workBy = a.finished + o.spotMins * 60000;
    }
  }
}
/* move past questions whose time ran out (the server clock is the authority) */
async function adv(a, ex) {
  const now = Date.now();
  while (a.status === 'in_progress') {
    const it = items(a)[a.cur];
    if (!it) { await settle(a, ex); continue; }
    const q = ex.questions[it.qi], t = (it.f ? q.fu.t : q.t) * 1000;
    if (now - a.qStart <= t + GRACE) break;
    (it.f ? a.fans : a.ans)[it.qi] = { s: -1, ms: t };
    a.cur++; a.qStart += t;
    await settle(a, ex);
  }
}

function view(a, ex, K) {
  const o = opt(ex);
  if (a.status !== 'in_progress') {
    const v = { status: a.status, title: ex.title };
    if (a.status === 'done' && (a.workReq || []).length) {
      v.work = {
        by: a.workBy, open: Date.now() <= a.workBy + 60000,
        items: a.workReq.map(qi => ({ qi, n: a.order.indexOf(qi) + 1, q: fill(ex.questions[qi].q, genVars(ex.questions[qi], a.seed, qi)), up: !!(a.work && a.work[qi]) })),
      };
    }
    return v;
  }
  const it = items(a)[a.cur], q = ex.questions[it.qi], vars = genVars(q, a.seed, it.qi), t = it.f ? q.fu.t : q.t;
  const base = {
    status: 'in_progress', title: ex.title, qi: it.qi, f: it.f, t, left: t * 1000 - (Date.now() - a.qStart),
    cur: it.f ? a.cur - a.order.length : a.cur, total: it.f ? a.fu.length : a.order.length, leaves: a.leaves || 0, max: ex.maxLeaves || 0,
  };
  if (it.f) {
    const cp = o.shuffleC ? perm(q.fu.c.length, a.seed + '|f|' + it.qi) : [...q.fu.c.keys()];
    return { ...base, type: 'mc', q: fill(q.fu.q, { ...vars, ans: ansVal(q, K[it.qi] || {}, vars) }), ctx: fill(q.q, vars), choices: cp.map(j => ({ i: j, t: q.fu.c[j] })) };
  }
  const cp = o.shuffleC ? perm(q.c.length, a.seed + '|c|' + it.qi) : [...q.c.keys()];
  return { ...base, type: q.type || 'mc', q: fill(q.q, vars), choices: cp.map(j => ({ i: j, t: q.c[j] })) };
}
async function V(a, ex) {
  const o = opt(ex), it = a.status === 'in_progress' ? items(a)[a.cur] : null;
  const K = (it && it.f) || (a.status !== 'in_progress' && o.showScore) ? (await r.get('key')) || [] : [];
  const v = view(a, ex, K);
  if (v.status !== 'in_progress') {
    v.receipt = rc(a); v.finished = a.finished || 0;
    if (o.showScore) { v.score = score(a, K, ex); v.of = maxPts(ex); }
  } else v.ann = await r.get('ann');
  return v;
}
async function loadAtt(b) {
  const ex = await r.get('exam');
  if (!ex) throw err('No exam');
  const a = await r.get(aKey(b.sid));
  if (!a || a.token !== b.token) throw err('Session not found. Ask your professor to reset you.', 403);
  return { a, ex };
}

/* ---------------- analysis: scores, flags, integrity risk ---------------- */
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const given = (q, g) => !g ? '—' : q.type === 'num' ? (att(q, g) ? String(g.v).trim() + (g.u ? ' ' + g.u : '') : '—') : (g.s >= 0 ? L(g.s) : '—');
const kTxt = (q, k) => q.type === 'num' ? (k.f ? 'formula: ' + k.f : (k.v || []).join(' / ')) + (k.u ? ' ' + k.u : '') : (k.a != null ? L(k.a) + ') ' + q.c[k.a] : '');

function analyze(ex, K, atts) {
  const o = opt(ex), Q = ex.questions, N = Q.length, now = Date.now();
  const A = atts.map(a => ({
    a,
    rows: Q.map((q, i) => {
      const k = K[i] || {}, g = a.ans && a.ans[i], vars = genVars(q, a.seed, i), ev = q.type === 'num' ? expectNum(k, vars) : null;
      return {
        ok: !g ? -1 : corr(q, k, g, o, vars) ? 1 : 0, to: !!g && !att(q, g), ms: g ? g.ms : 0, vars, ev,
        got: given(q, g), exp: q.type === 'num' ? (ev.length ? ev.map(fmt).join(' / ') + (k.u ? ' ' + k.u : '') : '?') : L(k.a || 0),
        gv: q.type === 'num' && att(q, g) ? pf(g.v) : null, gs: q.type !== 'num' && g && g.s >= 0 ? g.s : -1,
      };
    }),
  }));
  const qs = Q.map((q, i) => {
    const g = A.filter(x => x.rows[i].ok !== -1), real = g.filter(x => !x.rows[i].to).map(x => x.rows[i].ms);
    return {
      n: i + 1, q: q.q, type: q.type, t: q.t, key: kTxt(q, K[i] || {}), rand: !!(q.vars && q.vars.length),
      pct: g.length ? g.filter(x => x.rows[i].ok === 1).length / g.length : null,
      avg: g.length ? g.reduce((s, x) => s + x.rows[i].ms, 0) / g.length : null, med: median(real), cnt: real.length,
    };
  });
  const fl = new Map(A.map(x => [x.a.sid, []]));
  const F = (x, k, w, txt) => fl.get(x.a.sid).push({ k, w, txt });

  /* speed: correct far faster than the class (or than the time limit suggests) */
  A.forEach(x => {
    const hits = [];
    x.rows.forEach((rw, i) => {
      if (rw.ok !== 1) return;
      const real = qs[i].cnt >= 5, ref = real ? qs[i].med : Q[i].t * 500;
      if (ref >= 8000 && rw.ms < ref * 0.25) hits.push('Q' + (i + 1) + ' in ' + Math.round(rw.ms / 1000) + 's (' + (real ? 'class median ' : 'typical ') + Math.round(ref / 1000) + 's)');
    });
    if (hits.length) F(x, 'speed', Math.min(3, hits.length), 'Answered correctly much faster than expected: ' + hits.slice(0, 4).join('; ') + (hits.length > 4 ? ' and ' + (hits.length - 4) + ' more' : '') + '.');
  });

  /* similarity between pairs of students */
  const pairs = [];
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
    const x = A[i], y = A[j]; let sc = 0; const m = []; let borrowed = 0;
    for (let q = 0; q < N; q++) {
      const p = x.rows[q], s = y.rows[q];
      if (Q[q].type === 'num') {
        const tol = Math.max((K[q] || {}).tol || 0, 0.5);
        const borrow = (u, w) => u.ok === 0 && !u.to && u.gv != null && w.ev && w.ev.some(e => close(u.gv, e, tol));
        if (borrow(p, s) || borrow(s, p)) { sc += 3; borrowed++; m.push(q + 1); continue; }
        if (p.ok === 0 && s.ok === 0 && !p.to && !s.to && p.gv != null && s.gv != null && close(p.gv, s.gv, 0.1)) {
          const rand = Q[q].vars && Q[q].vars.length && JSON.stringify(p.vars) !== JSON.stringify(s.vars);
          sc += rand ? 2 : 1; m.push(q + 1);
        }
      } else if (p.ok === 0 && s.ok === 0 && p.gs >= 0 && p.gs === s.gs) { sc += 1; m.push(q + 1); }
    }
    if (sc >= 4) pairs.push({ x, y, sc, m, borrowed });
  }
  pairs.forEach(pr => {
    const w = pr.sc >= 8 ? 3 : 2;
    const txt = who => 'Same wrong answers as ' + who + ' on Q' + pr.m.join(', Q') + (pr.borrowed ? ' (including an answer that fits ' + who + "'s own numbers, not theirs)" : '') + '.';
    F(pr.x, 'similar', w, txt(pr.y.a.name + ' (' + pr.y.a.sid + ')'));
    F(pr.y, 'similar', w, txt(pr.x.a.name + ' (' + pr.x.a.sid + ')'));
  });

  /* pattern: misses easy items but gets hard ones */
  if (A.filter(x => x.a.status !== 'in_progress').length >= 8) A.forEach(x => {
    const em = [], hh = [];
    x.rows.forEach((rw, i) => { const p = qs[i].pct; if (p == null || rw.ok === -1) return; if (p >= 0.75 && rw.ok === 0) em.push(i + 1); if (p <= 0.35 && rw.ok === 1) hh.push(i + 1); });
    if (em.length >= 2 && hh.length >= 2) F(x, 'pattern', 2, 'Missed easy questions (Q' + em.join(', Q') + ') but got hard ones right (Q' + hh.join(', Q') + ').');
  });

  /* proctoring, follow-ups, work photos */
  A.forEach(x => {
    const a = x.a, ev = a.ev || [], aw = Math.round((a.away || 0) / 1000);
    if (a.status === 'locked') F(x, 'locked', 3, 'The exam auto-locked after too many departures.');
    if ((a.leaves || 0) >= 5) F(x, 'tabs', 2, 'Left the exam ' + a.leaves + ' times.'); else if ((a.leaves || 0) >= 3) F(x, 'tabs', 1, 'Left the exam ' + a.leaves + ' times.');
    if (aw >= 240) F(x, 'away', 2, 'Away from the exam for ' + aw + ' seconds in total.'); else if (aw >= 90) F(x, 'away', 1, 'Away from the exam for ' + aw + ' seconds in total.');
    const pc = ev.filter(e => e.k === 'paste' || e.k === 'keys').length;
    if (pc >= 3) F(x, 'paste', 1, 'Tried to copy, paste or use blocked shortcuts ' + pc + ' times.');
    const rl = ev.filter(e => e.k === 'resumed').length;
    if (rl >= 2) F(x, 'reload', 1, 'Reloaded the page ' + rl + ' times.');
    if (a.nofs) F(x, 'nofs', 0, 'Fullscreen was not available on this device, so leaving fullscreen could not be tracked.');
    (a.fu || []).forEach(qi => {
      const g = a.fans && a.fans[qi];
      if (!g || g.s !== (K[qi] || {}).fa) F(x, 'followup', 2, 'Answered Q' + (qi + 1) + ' correctly but missed the follow-up' + (g && g.s < 0 ? ' (timed out)' : '') + '.');
    });
    (a.workReq || []).forEach(qi => {
      if (a.work && a.work[qi]) return;
      if (now > a.workBy + 60000) F(x, 'nowork', 2, 'Did not upload the requested work photo for Q' + (qi + 1) + '.');
      else F(x, 'workpending', 0, 'Work photo for Q' + (qi + 1) + ' is still pending.');
    });
  });

  const tot = maxPts(ex);
  const out = A.map(x => {
    const a = x.a, flags = fl.get(a.sid), pts = flags.reduce((s, f) => s + f.w, 0), sc = score(a, K, ex);
    return {
      name: a.name, sid: a.sid, status: a.status, prog: a.cur < a.order.length ? (a.cur + 1) + '/' + N : 'follow-up',
      score: sc, of: tot, pct: tot ? Math.round(sc / tot * 100) / 100 : 0,
      leaves: a.leaves || 0, away: Math.round((a.away || 0) / 1000), receipt: rc(a), started: a.started, finished: a.finished || 0, seed: a.seed,
      review: a.review || '', ev: a.ev || [], rows: x.rows, flags, pts, risk: pts >= 6 ? 'High' : pts >= 3 ? 'Medium' : 'Low',
      fu: (a.fu || []).map(qi => ({ n: qi + 1, ok: !!(a.fans && a.fans[qi] && a.fans[qi].s === (K[qi] || {}).fa) })),
      workReq: (a.workReq || []).map(q => q + 1), work: Object.keys(a.work || {}).map(q => +q + 1), workBy: a.workBy || 0, synced: !!a.synced,
    };
  });
  return { qs, atts: out };
}
const sheetRow = x => ({
  sid: x.sid, name: x.name, status: x.status, score: x.score, of: x.of, pct: x.pct, leaves: x.leaves, away: x.away, risk: x.risk,
  flags: x.flags.filter(f => f.w > 0).map(f => f.txt).join(' | '), review: x.review, receipt: x.receipt,
  finished: x.finished ? new Date(x.finished).toISOString() : '', work: x.workReq.length ? x.work.length + '/' + x.workReq.length : '',
});

/* ---------------- Google Sheets (through the Apps Script web app) ---------------- */
async function pushSheet(url, key, payload, ms = 8000) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key, ...payload }), signal: ctl.signal, redirect: 'follow' });
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
    if (j && j.ok) return { ok: true, n: j.n || 0 };
    return { ok: false, msg: (j && j.error) || 'The Google script did not answer correctly (HTTP ' + res.status + '). Check that it is deployed as a web app with access set to "Anyone".' };
  } catch (e) { return { ok: false, msg: 'Could not reach the Google script: ' + (e.name === 'AbortError' ? 'timed out' : e.message) }; }
  finally { clearTimeout(tm); }
}
/* save an attempt; when it has just finished, send its row to the sheet */
async function put(a, ex) {
  const o = opt(ex), fin = a.status !== 'in_progress' && !a.synced && !!o.sheetUrl;
  await r.set(aKey(a.sid), a);
  if (!fin) return;
  const K = (await r.get('key')) || [];
  const x = analyze(ex, K, [a]).atts[0];
  const res = await pushSheet(o.sheetUrl, o.sheetKey, { title: ex.title, rows: [sheetRow(x)] }, 4000);
  if (res.ok) { a.synced = true; await r.set(aKey(a.sid), a); }
}
async function clearAtt(sid, ex) {
  const n = ex ? ex.questions.length : 200;
  await r.del(aKey(sid), ...Array.from({ length: n }, (_, i) => wKey(sid, i)));
  await r.srem('atts', norm(sid));
}
async function allAtts() {
  const ids = (await r.smembers('atts')) || [];
  return ids.length ? (await r.mget(...ids.map(i => 'att:' + i))).filter(Boolean) : [];
}

/* ---------------- routes ---------------- */
async function route(b, ip) {
  switch (b.action) {
    /* ---------- admin ---------- */
    case 'login':
      if (!SECRET) throw err('ADMIN_PASSWORD is not set on the server', 500);
      await limited(ip);
      if (!same(b.password ?? '', SECRET)) { await failed(ip); throw err('Wrong password', 401); }
      return { token: mkToken() };
    case 'load': {
      needAdmin(b);
      return { exam: await r.get('exam'), key: (await r.get('key')) || [] };
    }
    case 'save': {
      needAdmin(b);
      const old = await r.get('exam');
      if (old && old.status === 'open') throw err('Close the exam before editing it, so students who are mid-exam are not affected.');
      const raw = (Array.isArray(b.questions) ? b.questions : []).slice(0, 200);
      if (!raw.length) throw err('Add at least one question.');
      const qs = [], key = [];
      raw.forEach((q, i) => { const c = cleanQ(q, i); qs.push(c.item); key.push(c.key); });
      if (old && ((await r.scard('atts')) || 0) > 0) {
        const oldKey = (await r.get('key')) || [];
        if (JSON.stringify(old.questions) !== JSON.stringify(qs) || JSON.stringify(oldKey) !== JSON.stringify(key)) {
          throw err('Students already have attempts. Export the results, then use \"Clear all attempts\" in Results before changing questions. (Settings alone can still be saved.)');
        }
      }
      await r.set('exam', { title: String(b.title || 'Exam'), maxLeaves: Math.max(0, Math.floor(+b.maxLeaves || 0)), status: 'closed', set: mkSet(b.settings), questions: qs });
      await r.set('key', key);
      return { ok: 1 };
    }
    case 'preview': {
      needAdmin(b);
      const { item, key } = cleanQ(b.q || {}, +b.i || 0);
      const vars = genVars(item, crypto.randomBytes(4).toString('hex'), 0), ans = ansVal(item, key, vars);
      return {
        text: fill(item.q, vars), vars, exp: item.type === 'num' ? expectNum(key, vars).map(fmt).join(' / ') + (key.u ? ' ' + key.u : '') : L(key.a),
        fu: item.fu ? { q: fill(item.fu.q, { ...vars, ans }), c: item.fu.c, a: key.fa } : null,
      };
    }
    case 'status': {
      needAdmin(b);
      const ex = await r.get('exam');
      if (!ex) throw err('Save the exam first');
      ex.status = b.open ? 'open' : 'closed';
      await r.set('exam', ex);
      return { ok: 1, old: b.open ? ((await r.smembers('atts')) || []).length : 0 };
    }
    case 'results': {
      needAdmin(b);
      const ex = await r.get('exam');
      if (!ex) return { exam: null, qs: [], atts: [] };
      const out = analyze(ex, (await r.get('key')) || [], await allAtts());
      return { exam: ex, qs: out.qs, atts: out.atts };
    }
    case 'work': {
      needAdmin(b);
      const a = await r.get(aKey(b.sid));
      if (!a) throw err('Student not found');
      const imgs = {};
      for (const qi of Object.keys(a.work || {})) imgs[+qi + 1] = await r.get(wKey(a.sid, qi));
      return { imgs };
    }
    case 'review': {
      needAdmin(b);
      const a = await r.get(aKey(b.sid));
      if (!a) throw err('Student not found');
      a.review = ['cleared', 'oral'].includes(b.review) ? b.review : '';
      await r.set(aKey(b.sid), a);
      return { ok: 1 };
    }
    case 'reset': {
      needAdmin(b);
      await clearAtt(b.sid, await r.get('exam'));
      return { ok: 1 };
    }
    case 'clear': {
      needAdmin(b);
      const ex = await r.get('exam');
      if (ex && ex.status === 'open') throw err('Close the exam first');
      const ids = (await r.smembers('atts')) || [];
      for (const id of ids) await clearAtt(id, ex);
      await r.del('ann');
      return { ok: 1, n: ids.length };
    }
    case 'announce': {
      needAdmin(b);
      const t = String(b.text || '').trim().slice(0, 300);
      if (t) await r.set('ann', { text: t, at: Date.now() }); else await r.del('ann');
      return { ok: 1 };
    }
    case 'sheetTest':
    case 'sheetPush': {
      needAdmin(b);
      const url = String(b.url || '').trim(), key = String(b.key || '');
      if (!SHEET_RE.test(url)) throw err('Paste the web app URL that ends in /exec');
      let rows = [], title = '(test)';
      if (b.action === 'sheetPush') {
        const ex = await r.get('exam');
        if (!ex) throw err('Save the exam first');
        title = ex.title; rows = analyze(ex, (await r.get('key')) || [], await allAtts()).atts.map(sheetRow);
      }
      let n = 0;
      for (let i = 0; i === 0 || i < rows.length; i += 100) {
        const res = await pushSheet(url, key, { title, test: b.action === 'sheetTest', rows: rows.slice(i, i + 100) }, 9000);
        if (!res.ok) throw err(res.msg, 502);
        n += res.n;
      }
      return { ok: 1, n };
    }

    /* ---------- student ---------- */
    case 'info': {
      const ex = await r.get('exam');
      if (!ex) return { open: false, school: DEFS.school };
      const o = opt(ex);
      return {
        open: isOpen(ex), status: ex.status, now: Date.now(), opens: o.opens, closes: o.closes, title: ex.title, school: o.school, n: ex.questions.length,
        sec: ex.questions.reduce((s, q) => s + q.t, 0), maxLeaves: ex.maxLeaves, fu: o.followUps, spot: o.spot, spotMins: o.spotMins,
        s: { copyBlock: o.copyBlock, fsTrack: o.fsTrack, calc: o.calc, units: o.units, sheet: o.sheet },
      };
    }
    case 'start': {
      const ex = await r.get('exam');
      if (!ex) throw err('The exam is not open');
      const name = String(b.name || '').trim().slice(0, 80), sid = String(b.sid || '').trim().slice(0, 40);
      if (!name || !sid) throw err('Enter your name and student ID');
      let a = await r.get(aKey(sid));
      if (a) {
        if (a.token !== b.token) throw err(a.status === 'in_progress' ? 'This ID already started the exam on another device. Ask your professor to reset it.' : 'This ID has already submitted the exam. If that is a mistake, ask your professor to reset it.', 403);
        if (a.status === 'in_progress') {
          await adv(a, ex);
          if (a.status === 'in_progress') {
            a.leaves++; a.ev.push({ t: Date.now(), k: 'resumed', qi: items(a)[a.cur].qi }); lockIf(a, ex);
          }
        }
      } else {
        if (!isOpen(ex)) throw err('The exam is not open');
        const rs = opt(ex).roster;
        if (rs.length && !rs.includes(norm(sid))) throw err('Your ID is not on the class list');
        const seed = crypto.randomBytes(6).toString('hex');
        a = {
          name, sid, token: crypto.randomBytes(16).toString('hex'), seed, cur: 0, qStart: Date.now(), started: Date.now(),
          order: opt(ex).shuffleQ ? perm(ex.questions.length, seed + '|o') : [...ex.questions.keys()],
          ans: {}, fu: [], fans: {}, fuSet: false, work: {}, ev: [], leaves: 0, away: 0, awayAt: 0, review: '', status: 'in_progress',
        };
        await r.sadd('atts', norm(sid));
      }
      await put(a, ex);
      return { token: a.token, view: await V(a, ex) };
    }
    case 'state': {
      const { a, ex } = await loadAtt(b);
      const before = JSON.stringify(a);
      await adv(a, ex);
      if (JSON.stringify(a) !== before) await put(a, ex);
      return { view: await V(a, ex) };
    }
    case 'answer': {
      const { a, ex } = await loadAtt(b);
      await adv(a, ex);
      if (a.status === 'in_progress') {
        const it = items(a)[a.cur];
        if (it.qi === b.qi && !!it.f === !!b.f) {
          const q = ex.questions[it.qi], now = Date.now(), ms = Math.min(now - a.qStart, (it.f ? q.fu.t : q.t) * 1000);
          const n = it.f ? q.fu.c.length : q.c.length, sel = Number.isInteger(b.sel) && b.sel >= 0 && b.sel < n ? b.sel : -1;
          if (it.f) a.fans[it.qi] = { s: sel, ms };
          else a.ans[it.qi] = q.type === 'num' ? { v: String(b.v ?? '').slice(0, 40), u: String(b.u ?? '').slice(0, 20), ms } : { s: sel, ms };
          a.cur++; a.qStart = now;
          await settle(a, ex);
        }
      }
      await put(a, ex);
      return { view: await V(a, ex) };
    }
    case 'event': {
      const { a, ex } = await loadAtt(b);
      await adv(a, ex);
      if (a.status === 'in_progress') {
        const now = Date.now(), qi = items(a)[a.cur].qi;
        if (['tab_hidden', 'window_blur', 'fullscreen_exit'].includes(b.k)) {
          if (!a.awayAt) { a.awayAt = now; a.leaves++; a.ev.push({ t: now, k: b.k, qi }); lockIf(a, ex); }
        } else if (b.k === 'back') {
          if (a.awayAt) { const d = now - a.awayAt; a.away += d; a.awayAt = 0; a.ev.push({ t: now, k: 'back', d }); }
        } else if (b.k === 'nofs') {
          if (!a.nofs) { a.nofs = 1; a.ev.push({ t: now, k: 'nofs' }); }
        } else if (b.k === 'paste' || b.k === 'keys' || b.k === 'flag') {
          if (a.ev.length < 300) a.ev.push({ t: now, k: b.k, qi });
        }
      }
      await put(a, ex);
      return { view: await V(a, ex) };
    }
    case 'upload': {
      const { a, ex } = await loadAtt(b);
      const qi = +b.qi;
      if (a.status !== 'done' || !(a.workReq || []).includes(qi)) throw err('No photo was requested for that question');
      if (Date.now() > a.workBy + 60000) throw err('The upload window has closed');
      const img = String(b.img || '');
      if (img.length > WORK_MAX || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img)) throw err('The photo is too large or not a JPEG');
      const head = Buffer.from(img.slice(23, 43), 'base64');
      if (head[0] !== 0xff || head[1] !== 0xd8) throw err('That file is not a valid photo');
      await r.set(wKey(a.sid, qi), img);
      a.work = a.work || {}; a.work[qi] = Date.now();
      await r.set(aKey(a.sid), a);
      return { view: await V(a, ex) };
    }
    default: throw err('Unknown action');
  }
}

const DB_OK = !!((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!DB_OK) return res.status(500).json({ error: 'Database not connected. In Vercel: Storage > add Upstash Redis > connect to this project, then Redeploy.' });
  const ip = String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'x').split(',')[0].trim().slice(0, 45);
  try { res.json(await route(req.body || {}, ip)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || 'Server error' }); }
}