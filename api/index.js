import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const r = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const SECRET = process.env.AUTH_SECRET || '';
const GRACE = 1500;          // ms of network slack on every timer
const WORK_MAX = 600000;     // max characters of a work photo (base64 JPEG)
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const L = i => String.fromCharCode(65 + i);
const str = (s, n) => String(s ?? '').trim().slice(0, n);

/* ---------------- accounts (professors) ---------------- */
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const mkToken = email => { const p = Buffer.from(JSON.stringify({ e: email, x: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
function tokenEmail(t) {
  try {
    const [p, s] = String(t || '').split('.');
    if (!SECRET || !p || !s) return null;
    const a = Buffer.from(s), c = Buffer.from(sign(p));
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
    const j = JSON.parse(Buffer.from(p, 'base64url').toString());
    return j.x > Date.now() ? j.e : null;
  } catch { return null; }
}
async function needUser(b) {
  const e = tokenEmail(b.token), u = e && await r.get('u:' + e);
  if (!u) throw err('Please sign in again', 401);
  return u;
}
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32);
const pwOk = (pw, u) => { const h = hashPw(pw, u.salt), s = Buffer.from(u.hash, 'hex'); return h.length === s.length && crypto.timingSafeEqual(h, s); };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mkCode = n => Array.from(crypto.randomBytes(n), x => ALPHA[x % 32]).join('');
async function freshCode(prefix, n) { for (;;) { const c = mkCode(n); if (!(await r.exists(prefix + c))) return c; } }
async function throttle(kind, ip, max, secs) {
  const k = 'rl:' + kind + ':' + ip, n = await r.incr(k);
  if (n === 1) await r.expire(k, secs);
  if (n > max) throw err('Too many attempts. Please wait a few minutes and try again.', 429);
}
const profile = (u, sc) => ({ user: { name: u.name, email: u.email, admin: !!u.admin }, school: { name: sc.name, code: sc.code, fcode: u.admin ? sc.fcode : undefined } });
const eidOk = e => /^[a-f0-9]{10}$/.test(String(e || ''));
async function pubEx(eid) {
  const ex = eidOk(eid) && await r.get('e:' + eid);
  if (!ex) throw err('That exam does not exist (any more).', 404);
  return ex;
}
async function ownEx(b, u) {
  const ex = await pubEx(b.eid);
  if (ex.owner !== u.email) throw err('Exam not found', 404);
  return ex;
}
const getK = async ex => (await r.get('k:' + ex.id)) || [];

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
  sheet: '', opens: 0, closes: 0, roster: [], followUps: 0, spot: 0, spotMins: 15, sheetUrl: '', sheetKey: '',
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
    followUps: clamp(Math.floor(+s.followUps || 0), 0, 3), spot: clamp(Math.floor(+s.spot || 0), 0, 3), spotMins: clamp(Math.floor(+s.spotMins || 15), 1, 1440),
    sheetUrl: url, sheetKey: String(s.sheetKey || '').slice(0, 100),
  };
};

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
      const K = (await getK(ex));
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
  const K = (it && it.f) || (a.status !== 'in_progress' && o.showScore) ? (await getK(ex)) : [];
  const v = view(a, ex, K);
  if (v.status !== 'in_progress') {
    v.receipt = rc(a); v.finished = a.finished || 0;
    if (o.showScore) { v.score = score(a, K, ex); v.of = maxPts(ex); }
  } else v.ann = await r.get('ann:' + ex.id);
  return v;
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
  await r.set(aKey(a.eid, a.sid), a);
  if (!fin) return;
  const K = (await getK(ex));
  const x = analyze(ex, K, [a]).atts[0];
  const res = await pushSheet(o.sheetUrl, o.sheetKey, { title: ex.title, rows: [sheetRow(x)] }, 4000);
  if (res.ok) { a.synced = true; await r.set(aKey(a.eid, a.sid), a); }
}

const aKey = (eid, sid) => 'a:' + eid + ':' + norm(sid);
const wKey = (eid, sid, qi) => 'w:' + eid + ':' + norm(sid) + ':' + qi;
async function loadAtt(b) {
  const ex = await pubEx(b.eid);
  const a = await r.get(aKey(ex.id, b.sid));
  if (!a || a.token !== b.token) throw err('Session not found. Ask your professor to reset you.', 403);
  return { a, ex };
}
async function clearAtt(ex, sid) {
  await r.del(aKey(ex.id, sid), ...Array.from({ length: Math.max(ex.questions.length, 1) }, (_, i) => wKey(ex.id, sid, i)));
  await r.srem('as:' + ex.id, norm(sid));
}
async function allAtts(ex) {
  const ids = (await r.smembers('as:' + ex.id)) || [];
  return ids.length ? (await r.mget(...ids.map(i => 'a:' + ex.id + ':' + i))).filter(Boolean) : [];
}
async function dropExam(ex) {
  for (const id of ((await r.smembers('as:' + ex.id)) || [])) await clearAtt(ex, id);
  await r.del('e:' + ex.id, 'k:' + ex.id, 'ann:' + ex.id, 'as:' + ex.id);
  await r.srem('ue:' + ex.owner, ex.id); await r.srem('se:' + ex.school, ex.id);
}
const examCard = (ex, atts) => {
  const o = opt(ex), done = atts.filter(a => a.status !== 'in_progress').length;
  return { id: ex.id, title: ex.title, status: ex.status, scheduled: ex.status === 'open' && !!o.opens && Date.now() < o.opens, n: ex.questions.length, sec: ex.questions.reduce((s, q) => s + q.t, 0), opens: o.opens, closes: o.closes, total: atts.length, done, prog: atts.length - done, created: ex.created || 0 };
};
const examInfo = (ex, school, owner) => {
  const o = opt(ex);
  return {
    id: ex.id, open: isOpen(ex), status: ex.status, now: Date.now(), opens: o.opens, closes: o.closes, title: ex.title, school, by: owner,
    n: ex.questions.length, sec: ex.questions.reduce((s, q) => s + q.t, 0), maxLeaves: ex.maxLeaves, fu: o.followUps, spot: o.spot, spotMins: o.spotMins,
    s: { copyBlock: o.copyBlock, fsTrack: o.fsTrack, calc: o.calc, units: o.units, sheet: o.sheet },
  };
};

/* ---------------- routes ---------------- */
async function route(b, ip) {
  switch (b.action) {
    /* ---------- accounts ---------- */
    case 'register': {
      await throttle('reg', ip, 10, 3600);
      const name = str(b.name, 80), email = str(b.email, 120).toLowerCase();
      if (!name) throw err('Enter your name');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err('Enter a valid email address');
      if (String(b.password || '').length < 8) throw err('Your password must be at least 8 characters');
      if (await r.exists('u:' + email)) throw err('An account with this email already exists. Sign in instead.', 409);
      let sc;
      if (b.mode === 'join') {
        const code = await r.get('fc:' + str(b.facultyCode, 20).toUpperCase());
        sc = code && await r.get('s:' + code);
        if (!sc) throw err('That faculty code was not found. Ask the person who set up your school for it.');
      } else {
        const sn = str(b.schoolName, 80);
        if (!sn) throw err('Enter your school name');
        sc = { code: await freshCode('s:', 6), fcode: await freshCode('fc:', 10), name: sn, created: Date.now() };
        await r.set('s:' + sc.code, sc); await r.set('fc:' + sc.fcode, sc.code);
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const u = { email, name, school: sc.code, salt, hash: hashPw(b.password, salt).toString('hex'), admin: b.mode !== 'join', created: Date.now() };
      await r.set('u:' + email, u);
      return { token: mkToken(email), ...profile(u, sc) };
    }
    case 'login': {
      if (!SECRET) throw err('AUTH_SECRET is not set on the server', 500);
      await throttle('login', ip, 15, 900);
      const u = await r.get('u:' + str(b.email, 120).toLowerCase());
      if (!u || !pwOk(b.password, u)) throw err('Wrong email or password', 401);
      return { token: mkToken(u.email), ...profile(u, await r.get('s:' + u.school)) };
    }
    case 'me': {
      const u = await needUser(b);
      return profile(u, await r.get('s:' + u.school));
    }
    case 'school': {
      await throttle('sch', ip, 60, 600);
      const sc = await r.get('s:' + str(b.code, 10).toUpperCase());
      if (!sc) throw err('We could not find a school with that code. Check it with your professor.', 404);
      return { name: sc.name, code: sc.code };
    }

    /* ---------- professor: exams ---------- */
    case 'exams': {
      const u = await needUser(b);
      const ids = (await r.smembers('ue:' + u.email)) || [];
      const list = [];
      for (const id of ids) {
        const ex = await r.get('e:' + id); if (!ex) continue;
        list.push(examCard(ex, await allAtts(ex)));
      }
      return { exams: list.sort((a, c) => c.created - a.created) };
    }
    case 'create': {
      const u = await needUser(b);
      if (((await r.scard('ue:' + u.email)) || 0) >= 100) throw err('You have reached the limit of 100 exams. Delete one first.');
      const id = crypto.randomBytes(5).toString('hex');
      await r.set('e:' + id, { id, school: u.school, owner: u.email, title: str(b.title, 120) || 'Untitled exam', maxLeaves: 3, status: 'closed', set: mkSet({}), questions: [], created: Date.now() });
      await r.set('k:' + id, []);
      await r.sadd('ue:' + u.email, id); await r.sadd('se:' + u.school, id);
      return { id };
    }
    case 'delete': {
      const ex = await ownEx(b, await needUser(b));
      if (ex.status === 'open') throw err('Close the exam before deleting it.');
      await dropExam(ex);
      return { ok: 1 };
    }
    case 'load': {
      const ex = await ownEx(b, await needUser(b));
      return { exam: ex, key: await getK(ex) };
    }
    case 'save': {
      const ex = await ownEx(b, await needUser(b));
      if (ex.status === 'open') throw err('Close the exam before editing it, so students who are mid-exam are not affected.');
      const raw = (Array.isArray(b.questions) ? b.questions : []).slice(0, 200);
      if (!raw.length) throw err('Add at least one question.');
      const qs = [], key = [];
      raw.forEach((q, i) => { const c = cleanQ(q, i); qs.push(c.item); key.push(c.key); });
      if (ex.questions.length && ((await r.scard('as:' + ex.id)) || 0) > 0) {
        const oldKey = await getK(ex);
        if (JSON.stringify(ex.questions) !== JSON.stringify(qs) || JSON.stringify(oldKey) !== JSON.stringify(key)) {
          throw err('Students already have attempts. Export the results, then use "Clear all attempts" in Results before changing questions. (Settings alone can still be saved.)');
        }
      }
      await r.set('e:' + ex.id, { ...ex, title: str(b.title, 120) || 'Untitled exam', maxLeaves: Math.max(0, Math.floor(+b.maxLeaves || 0)), set: mkSet(b.settings), questions: qs });
      await r.set('k:' + ex.id, key);
      return { ok: 1 };
    }
    case 'preview': {
      await needUser(b);
      const { item, key } = cleanQ(b.q || {}, +b.i || 0);
      const vars = genVars(item, crypto.randomBytes(4).toString('hex'), 0), ans = ansVal(item, key, vars);
      return {
        text: fill(item.q, vars), vars, exp: item.type === 'num' ? expectNum(key, vars).map(fmt).join(' / ') + (key.u ? ' ' + key.u : '') : L(key.a),
        fu: item.fu ? { q: fill(item.fu.q, { ...vars, ans }), c: item.fu.c, a: key.fa } : null,
      };
    }
    case 'status': {
      const ex = await ownEx(b, await needUser(b));
      if (b.open && !ex.questions.length) throw err('Save at least one question before opening the exam.');
      ex.status = b.open ? 'open' : 'closed';
      await r.set('e:' + ex.id, ex);
      return { ok: 1, old: b.open ? ((await r.scard('as:' + ex.id)) || 0) : 0 };
    }
    case 'results': {
      const ex = await ownEx(b, await needUser(b));
      const out = analyze(ex, await getK(ex), await allAtts(ex));
      return { exam: ex, qs: out.qs, atts: out.atts };
    }
    case 'work': {
      const ex = await ownEx(b, await needUser(b));
      const a = await r.get(aKey(ex.id, b.sid));
      if (!a) throw err('Student not found');
      const imgs = {};
      for (const qi of Object.keys(a.work || {})) imgs[+qi + 1] = await r.get(wKey(ex.id, a.sid, qi));
      return { imgs };
    }
    case 'review': {
      const ex = await ownEx(b, await needUser(b));
      const a = await r.get(aKey(ex.id, b.sid));
      if (!a) throw err('Student not found');
      a.review = ['cleared', 'oral'].includes(b.review) ? b.review : '';
      await r.set(aKey(ex.id, b.sid), a);
      return { ok: 1 };
    }
    case 'reset': {
      const ex = await ownEx(b, await needUser(b));
      await clearAtt(ex, b.sid);
      return { ok: 1 };
    }
    case 'clear': {
      const ex = await ownEx(b, await needUser(b));
      if (ex.status === 'open') throw err('Close the exam first');
      const ids = (await r.smembers('as:' + ex.id)) || [];
      for (const id of ids) await clearAtt(ex, id);
      await r.del('ann:' + ex.id);
      return { ok: 1, n: ids.length };
    }
    case 'announce': {
      const ex = await ownEx(b, await needUser(b));
      const t = str(b.text, 300);
      if (t) await r.set('ann:' + ex.id, { text: t, at: Date.now() }); else await r.del('ann:' + ex.id);
      return { ok: 1 };
    }
    case 'sheetTest':
    case 'sheetPush': {
      const ex = await ownEx(b, await needUser(b));
      const url = str(b.url, 300), key = String(b.key || '');
      if (!SHEET_RE.test(url)) throw err('Paste the web app URL that ends in /exec');
      let rows = [], title = '(test)';
      if (b.action === 'sheetPush') { title = ex.title; rows = analyze(ex, await getK(ex), await allAtts(ex)).atts.map(sheetRow); }
      let n = 0;
      for (let i = 0; i === 0 || i < rows.length; i += 100) {
        const res = await pushSheet(url, key, { title, test: b.action === 'sheetTest', rows: rows.slice(i, i + 100) }, 9000);
        if (!res.ok) throw err(res.msg, 502);
        n += res.n;
      }
      return { ok: 1, n };
    }

    /* ---------- student ---------- */
    case 'sexams': {
      const sc = await r.get('s:' + str(b.code, 10).toUpperCase());
      if (!sc) throw err('School not found. Sign in again.', 404);
      const sid = str(b.sid, 40), tokens = b.tokens && typeof b.tokens === 'object' ? b.tokens : {};
      const ids = (await r.smembers('se:' + sc.code)) || [], out = [], now = Date.now();
      for (const id of ids) {
        const ex = await r.get('e:' + id); if (!ex || !ex.questions.length) continue;
        let a = sid ? await r.get(aKey(ex.id, sid)) : null;
        if (a && a.token !== tokens[ex.id]) a = null;
        const o = opt(ex), upcoming = ex.status === 'open' && o.opens && now < o.opens;
        if (!a && !isOpen(ex) && !upcoming) continue;
        let my = null;
        if (a) {
          const before = JSON.stringify(a);
          await adv(a, ex);
          if (JSON.stringify(a) !== before) await put(a, ex);
          my = await V(a, ex);
        }
        const ow = await r.get('u:' + ex.owner);
        out.push({ ...examInfo(ex, sc.name, ow ? ow.name : ''), my });
      }
      return { school: sc.name, exams: out };
    }
    case 'info': {
      const ex = await pubEx(b.eid);
      const [sc, ow] = await Promise.all([r.get('s:' + ex.school), r.get('u:' + ex.owner)]);
      return examInfo(ex, sc ? sc.name : '', ow ? ow.name : '');
    }
    case 'start': {
      const ex = await pubEx(b.eid);
      const name = str(b.name, 80), sid = str(b.sid, 40);
      if (!name || !sid) throw err('Enter your name and student ID');
      if (ex.school !== String(b.code || '').toUpperCase()) throw err('This exam belongs to a different school', 403);
      let a = await r.get(aKey(ex.id, sid));
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
          eid: ex.id, name, sid, token: crypto.randomBytes(16).toString('hex'), seed, cur: 0, qStart: Date.now(), started: Date.now(),
          order: opt(ex).shuffleQ ? perm(ex.questions.length, seed + '|o') : [...ex.questions.keys()],
          ans: {}, fu: [], fans: {}, fuSet: false, work: {}, ev: [], leaves: 0, away: 0, awayAt: 0, review: '', status: 'in_progress',
        };
        await r.sadd('as:' + ex.id, norm(sid));
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
      await r.set(wKey(ex.id, a.sid, qi), img);
      a.work = a.work || {}; a.work[qi] = Date.now();
      await r.set(aKey(ex.id, a.sid), a);
      return { view: await V(a, ex) };
    }
    default: throw err('Unknown action');
  }
}

const DB_OK = !!((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!DB_OK) return res.status(500).json({ error: 'Database not connected. Add an Upstash Redis database and set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (see README).' });
  const ip = String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'x').split(',')[0].trim().slice(0, 45);
  try { res.json(await route(req.body || {}, ip)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || 'Server error' }); }
}