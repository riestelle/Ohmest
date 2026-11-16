/**
 * ProctorQuiz -> Google Sheets receiver.
 * Paste this into Extensions > Apps Script of your Google Sheet, change KEY, then
 * Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 * Copy the web app URL (ends in /exec) into ProctorQuiz > Settings > Google Sheets,
 * and type the same KEY into the "Sheet key" box.
 */
const KEY = 'change-this-to-your-own-secret';
const TAB = 'Results';
const HEAD = ['Student ID', 'Name', 'Status', 'Score', 'Out of', 'Percent', 'Times left exam', 'Seconds away', 'Integrity risk', 'Flags', 'Professor review', 'Receipt', 'Finished', 'Work photos', 'Last updated'];

function doGet() { return out({ ok: true, msg: 'ProctorQuiz sheet receiver is running' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const d = JSON.parse(e.postData.contents);
    if (d.key !== KEY) return out({ ok: false, error: 'The sheet key does not match the KEY inside the Google script.' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
    if (sh.getLastRow() === 0) { sh.appendRow(HEAD); sh.setFrozenRows(1); sh.getRange('A:A').setNumberFormat('@'); }
    const rows = d.rows || [];
    if (!rows.length) return out({ ok: true, n: 0 });
    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
    const now = new Date();
    rows.forEach(r => {
      const vals = [String(r.sid), r.name, r.status, r.score, r.of, r.pct, r.leaves, r.away, r.risk, r.flags, r.review, r.receipt, r.finished, r.work, now];
      const at = ids.indexOf(String(r.sid));
      if (at >= 0) sh.getRange(at + 2, 1, 1, vals.length).setValues([vals]);
      else { sh.appendRow(vals); ids.push(String(r.sid)); }
    });
    sh.getRange(2, 6, Math.max(1, sh.getLastRow() - 1), 1).setNumberFormat('0%');
    return out({ ok: true, n: rows.length });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }