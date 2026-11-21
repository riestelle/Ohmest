/* Ohmest math formatter: turns plain-typed formulas (x=y/z, v^2, sqrt(a+b), v_0, theta) into standard notation.
   No libraries, so it keeps working during an exam even if a CDN is slow.
   Use MathFmt.rich(text) for question text: it formats $...$ blocks and obvious formulas like x=y/z or v^2.
   Use MathFmt.html(expr) to format one expression. Output is always escaped HTML. */
const MathFmt = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', infty: '∞', infinity: '∞' };
  const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sec', 'csc', 'cot', 'ln', 'log', 'exp', 'min', 'max', 'sinh', 'cosh', 'tanh']);
  const SYM = { '<=': '≤', '>=': '≥', '!=': '≠', '~=': '≈', '+-': '±', '->': '→', '=>': '⇒', '==': '=' };

  function lex(s) {
    s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, 'pi');
    const re = /\s+|(?:\d+\.?\d*|\.\d+)|[A-Za-z]+|<=|>=|!=|~=|\+-|->|=>|==|[{}()\[\]+\-*/^_=<>,|%!]|./gy, out = [];
    let m; while ((m = re.exec(s))) { if (/^\s+$/.test(m[0])) continue; out.push(m[0]); }
    return out;
  }
  function parse(src, stack = true) {
    const T = lex(src); let p = 0;
    const peek = () => T[p], nxt = () => T[p++];
    const isNum = t => t !== undefined && /^(?:\d|\.\d)/.test(t);
    const isId = t => t !== undefined && /^[A-Za-z]/.test(t);
    function group(open, close) { nxt(); const e = expr(close); if (peek() === close) nxt(); return e; }
    function script() {                                  // the thing after ^ or _
      let t = peek(), sign = '';
      if (t === '{') return group('{', '}');
      if (t === '(') return group('(', ')');
      if (t === '-' || t === '+') { sign = nxt() === '-' ? '−' : '+'; t = peek(); }
      if (t === undefined) return esc(sign);
      nxt();
      return esc(sign) + (isNum(t) ? esc(t) : isId(t) ? (GREEK[t] ? GREEK[t] : '<i>' + esc(t) + '</i>') : esc(t));
    }
    function atom() {
      const t = nxt();
      if (t === undefined) return '';
      let h;
      if (t === '(') { const e = expr(')'); if (peek() === ')') nxt(); h = '(' + e + ')'; }
      else if (t === '[') { const e = expr(']'); if (peek() === ']') nxt(); h = '[' + e + ']'; }
      else if (t === '{') { const e = expr('}'); if (peek() === '}') nxt(); h = e; }
      else if (t === '|') { const e = expr('|'); if (peek() === '|') nxt(); h = '|' + e + '|'; }
      else if (isNum(t)) h = esc(t);
      else if (t === 'sqrt' && (peek() === '(' || peek() === '{')) { const o = peek(); h = '<span class="mx-sq">√<span class="mx-rad">' + group(o, o === '(' ? ')' : '}') + '</span></span>'; }
      else if (t === 'abs' && peek() === '(') h = '|' + group('(', ')') + '|';
      else if (isId(t)) {
        if (GREEK[t]) h = GREEK[t];
        else if (FUNCS.has(t)) h = '<span class="mx-fn">' + esc(t) + '</span>';
        else if (t === 'deg') h = '°';
        else h = '<i>' + esc(t) + '</i>';
      } else if (SYM[t]) h = SYM[t];
      else h = esc(t);
      for (;;) {                                         // sub/superscripts (either order)
        if (peek() === '^') { nxt(); h += '<sup>' + script() + '</sup>'; }
        else if (peek() === '_') { nxt(); h += '<sub>' + subscr() + '</sub>'; }
        else break;
      }
      return h;
    }
    function subscr() {                                  // v_max, x_0, x_{ab}
      const t = peek();
      if (t === '{') return group('{', '}');
      if (t === '(') return group('(', ')');
      nxt(); return isNum(t) ? esc(t) : isId(t) ? '<i>' + esc(GREEK[t] || t) + '</i>' : esc(t || '');
    }
    function unary() { if (peek() === '-') { nxt(); return '−' + unary(); } if (peek() === '+') { nxt(); return '+' + unary(); } return atomRun(); }
    function atomRun() {                                 // implicit multiplication: 2a, ma, 2(x+1)
      let h = atom();
      for (;;) {
        const t = peek();
        if (t === undefined) break;
        if (isNum(t) || isId(t) || t === '(' || t === '[') h += atom(); else break;
      }
      return h;
    }
    function term(stop) {                                // * and / (left to right); / becomes a stacked fraction
      let h = unary();
      while (peek() === '*' || peek() === '/') {
        const o = nxt();
        if (o === '*') h += '<span class="mx-op">·</span>' + unary();
        else if (!stack) h += '/' + unary();
        else if (/^\d+\.?\d*$/.test(strip(h)) && isNum(peek())) {   // 1/2 m v^2 means (1/2)*m*v^2, not 1/(2 m v^2)
          h = '<span class="mx-fr"><span class="mx-nu">' + strip(h) + '</span><span class="mx-de">' + esc(nxt()) + '</span></span>';
          for (;;) { const t = peek(); if (t !== undefined && (isNum(t) || isId(t) || t === '(' || t === '[')) h += atom(); else break; }
        }
        else h = '<span class="mx-fr"><span class="mx-nu">' + strip(h) + '</span><span class="mx-de">' + strip(unary()) + '</span></span>';
      }
      return h;
    }
    const strip = h => h.replace(/^\((.*)\)$/s, (m, i) => balanced(i) ? i : m);
    function balanced(s) { let d = 0; for (const c of s.replace(/<[^>]*>/g, '')) { if (c === '(') d++; else if (c === ')' && --d < 0) return false; } return d === 0; }
    function expr(stop) {
      let h = term(stop);
      while (p < T.length && peek() !== stop) {
        const t = nxt();
        if (t === '+' || t === '-') h += '<span class="mx-op">' + (t === '-' ? '−' : '+') + '</span>' + term(stop);
        else if (t === ',') h += ', ' + term(stop);
        else if (['=', '<', '>', '<=', '>=', '!=', '~=', '->', '=>', '=='].includes(t)) h += '<span class="mx-rel">' + (SYM[t] || t) + '</span>' + term(stop);
        else if (t === '+-') h += '<span class="mx-op">±</span>' + term(stop);
        else if (t === '%' || t === '!') h += t;
        else if (t === ')' || t === ']' || t === '}') h += esc(t);
        else { p--; h += term(stop); }
      }
      return h;
    }
    const out = expr(undefined);
    return out;
  }
  const html = (src, stack = true) => { try { return '<span class="mx">' + parse(String(src ?? ''), stack) + '</span>'; } catch (e) { return esc(src); } };

  const TRIG = /[=^_]|sqrt\(|<=|>=|!=|~=|\+-|->|=>/;
  function tokenToMath(tok) {
    const m = tok.match(/^([(\["'“]*)([\s\S]*?)([.,;:!?"'”]*)$/);
    let lead = m[1], core = m[2], tail = m[3];
    const bal = s => { let d = 0; for (const c of s) { if (c === '(') d++; else if (c === ')') d--; } return d; };
    while (lead.endsWith('(') && bal(core) < 0) { core = '(' + core; lead = lead.slice(0, -1); }   // leading ( was ours
    let k = bal(core); while (k < 0 && core.endsWith(')')) { core = core.slice(0, -1); tail = ')' + tail; k++; }
    if (!core || !/[A-Za-z0-9]/.test(core) || !(TRIG.test(core) || /[A-Za-z0-9)]\*[A-Za-z0-9(]/.test(core)) || /:\/\/|@|^https?|^www\./i.test(core) || /^[=^_]+$/.test(core)) return esc(tok);
    return esc(lead) + html(core, core.includes('=')) + esc(tail);   // a bare m/s^2 stays a slash; equations get stacked fractions
  }
  /* question text: $...$ is always math; whitespace-free tokens such as x=y/z, v^2, a_1 are auto-detected */
  function rich(text) {
    const s = String(text ?? ''), parts = s.split(/(\$(?!\s)[^$\n]*?[^\s$]\$|\$[^\s$]\$)/);
    return parts.map(seg => {
      if (seg.length > 2 && seg[0] === '$' && seg[seg.length - 1] === '$') return html(seg.slice(1, -1));
      return seg.split(/(\s+)/).map(w => (/^\s*$/.test(w) ? esc(w) : tokenToMath(w))).join('');
    }).join('');
  }
  return { html, rich, esc };
})();
if (typeof module !== 'undefined') module.exports = MathFmt;