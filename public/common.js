/* Shared helpers for every Ohmest page */
/* icons stay invisible until the icon font is really there, so a blocked or slow font never shows words like "arrow_forward" */
(() => { const d = document.documentElement, on = () => d.classList.add('ico'); try { document.fonts.load('20px "Material Symbols Outlined"', 'home').then(f => { if (f.length) on(); }, () => {}); } catch (e) { on(); } })();
const $ = id => document.getElementById(id), app = $('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = i => String.fromCharCode(65 + i);
const ls = { get: (k, s = localStorage) => { try { return s.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch (e) { /* storage blocked */ } }, del: (k, s = localStorage) => { try { s.removeItem(k); } catch (e) { /* ignore */ } } };
let TK = ls.get('oh_tk');                                   // professor session token
const student = () => { try { return JSON.parse(ls.get('oh_stu', sessionStorage) || 'null'); } catch (e) { return null; } };
/* attempt tokens live in localStorage, one bucket per school code + student ID, so finished exams stay in the student's list after the tab is closed */
const attKey = () => { const w = student(); return 'oh_att:' + (w ? w.code + ':' + String(w.sid).toLowerCase() : ''); };
const attempts = () => { try { return JSON.parse(ls.get(attKey()) || '{}') || {}; } catch (e) { return {}; } };
const saveAttempt = (eid, token) => ls.set(attKey(), JSON.stringify({ ...attempts(), [eid]: token }));

const signOut = () => { TK = ''; ls.del('oh_tk'); ls.del('oh_me'); ls.del('oh_stu', sessionStorage); ls.del('oh_att', sessionStorage); };

async function api(action, d = {}) {
  const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: TK, ...d }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong (' + r.status + ')'); e.status = r.status; throw e; }
  return j;
}
/* professor pages call this on any failure: expired sessions go back to sign-in */
function profFail(e) { if (e.status === 401) { signOut(); location.replace('prof-login.html'); return true; } return false; }
function needProf() { if (!TK) { location.replace('prof-login.html'); return false; } return true; }

let _t;
function toast(m) {
  let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = m; t.style.display = ''; clearTimeout(_t); _t = setTimeout(() => { t.style.display = 'none'; }, 3200);
}
const copy = (txt, label) => { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast((label || 'Copied') + ' copied'), () => toast('Copy failed. Select and copy it manually.')); };
const initials = n => (String(n || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2) || '?').toUpperCase();

/* header + footer. who = { name, sub }, nav = [[label, href, key]] */
function chrome({ nav = [], active = '', who = null, home = 'index.html', logout = 'index.html' }) {
  const links = nav.map(([l, h, k]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('');
  const me = who ? `<div class="me" id="me"><button type="button" aria-label="Account menu" aria-haspopup="true"><span class="av">${esc(initials(who.name))}</span><span class="ms">expand_more</span></button>
<div class="menu"><div class="who"><b>${esc(who.name)}</b><span>${esc(who.sub || '')}</span></div><button type="button" id="out"><span class="ms">logout</span>Sign out</button></div></div>` : '';
  $('hdr').outerHTML = `<header class="hdr" id="hdr"><div class="in"><div class="l"><a class="logo" href="${home}"><i>O</i>Ohmest</a><nav class="nav">${links}</nav></div>${me}</div></header>`;
  $('ftr').outerHTML = '<footer class="ftr" id="ftr"><div><span>© ' + new Date().getFullYear() + ' Ohmest</span>' + (who ? '' : '<span class="fl" style="display:flex;gap:20px"><a href="student-login.html">Student sign in</a><a href="prof-login.html">Professor sign in</a></span>') + '</div></footer>';
  const m = $('me');
  if (m) {
    m.firstElementChild.onclick = e => { e.stopPropagation(); m.classList.toggle('open'); };
    document.addEventListener('click', () => m.classList.remove('open'));
    $('out').onclick = () => { signOut(); location.href = logout; };
  }
}

/* copy text to clipboard (works on http/https and old browsers) */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} a.remove(); return ok;
}