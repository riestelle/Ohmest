/* Number parsing and the safe formula evaluator (no eval, no Function). Pure functions, so `npm test` can check them without a database. */
const D = Math.PI / 180;
export const FN = {
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sin: x => Math.sin(x * D), cos: x => Math.cos(x * D), tan: x => Math.tan(x * D),
  asin: x => Math.asin(x) / D, acos: x => Math.acos(x) / D, atan: x => Math.atan(x) / D, atan2: (y, x) => Math.atan2(y, x) / D,
  sinr: Math.sin, cosr: Math.cos, tanr: Math.tan,
};
export const RESERVED = new Set(['pi', 'e', 'ans', ...Object.keys(FN)]);
export function evalF(src, vars) {
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

/* what a student types in a numeric box: 3.5, 3,5, 1,500, 1/4, 3x10^8, 2pi, sqrt(2), 9.8 m/s.
   A comma followed by exactly three digits is a thousands separator (1,500 = 1500); any other single comma is a decimal comma (3,5 = 3.5).
   Text after the number is read as a unit and ignored ("1/2 kg" = 0.5). The letter e is only ever part of 3e8 notation, never Euler's number. */
const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
export function pf(v) {
  let s = String(v ?? '').trim().replace(/[−–]/g, '-').replace(/[\u00a0\u202f]/g, ' ').replace(/[.,;]+$/, '');
  if (!s || s.length > 40) return NaN;
  if (/^[-+]?\d{1,3}(?: \d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/ /g, '');                       // 1 000 000
  const lm = s.match(/^[-+]?\d[\d,]*(?:\.\d+)?/);                                                      // the number the answer starts with
  if (lm) {
    const t = lm[0], n = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t) ? t.replace(/,/g, '') : /^[-+]?\d+,\d+$/.test(t) ? t.replace(',', '.') : t;
    s = n + s.slice(t.length);
  }
  if (/\d\s+[\d.]/.test(s)) return NaN;                                                              // "2 5" is not one number
  if (NUM_RE.test(s)) return parseFloat(s);
  s = s.replace(/(\d)\s*[xX]\s*(10\s*\^)/g, '$1*$2');
  const calc = x => { try { const n = evalF(fixF(x), { e: NaN }); return isFinite(n) ? n : null; } catch { return null; } };
  const whole = calc(s); if (whole !== null) return whole;
  const m = s.match(/^([\d\s.+\-*/^()×÷·]*[\d)])(.*)$/s);                                              // a calculation, then maybe a unit
  if (m && /^\s*(?:[A-Za-zµμΩ°%'"]|$)/.test(m[2])) { const n = NUM_RE.test(m[1].trim()) ? parseFloat(m[1]) : calc(m[1]); if (n !== null) return n; }
  return NaN;
}
/* make a typed formula standard: × ÷ − √ π ² unicode, [ ] brackets, "x = ..." prefix, and implicit multiplication (2a, ma, 2(x+1), (a)(b)) */
export function fixF(src, names = []) {
  const s = String(src).replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√\s*(\d+\.?\d*|[A-Za-z_]\w*)/g, 'sqrt($1)').replace(/√/g, 'sqrt').replace(/π/g, 'pi').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\[/g, '(').replace(/\]/g, ')');
  const T = s.match(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|\S/g) || [], out = [];
  const isFn = t => Object.hasOwn(FN, t), isId = t => /^[A-Za-z_]/.test(t), isNum = t => /^(?:\d|\.\d)/.test(t);
  T.forEach(t => {
    if (isId(t) && !names.includes(t) && !RESERVED.has(t) && t.length > 1 && [...t].every(c => names.includes(c))) {   // "ma" -> m * a
      [...t].forEach((c, i) => { if (i) out.push('*'); out.push(c); }); return;
    }
    out.push(t);
  });
  const res = [];
  out.forEach((t, i) => {
    const p = out[i - 1];
    if (p !== undefined && t !== '*') {
      const left = isNum(p) || (isId(p) && !isFn(p)) || p === ')', right = isNum(t) || isId(t) || t === '(';
      if (left && right && !(isFn(p) && t === '(')) res.push('*');
    }
    res.push(t);
  });
  return res.join(' ');
}