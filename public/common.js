/* shared by the student page and the professor page */
const $ = id => document.getElementById(id), app = $('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const L = i => String.fromCharCode(65 + i);
let TK = '';
try { TK = sessionStorage.getItem('tk') || ''; } catch (e) { /* storage blocked */ }
async function api(action, d = {}) {
  const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: TK, ...d }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
  return j;
}
function setHeader(t) { const h = $('sch'); if (h) h.textContent = t || 'ProctorQuiz'; document.title = (t ? t + ' · ' : '') + 'ProctorQuiz'; }