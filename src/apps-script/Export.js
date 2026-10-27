// Export for the move to the database (scripts/import-sheets.js, owner only, read only): one month's spreadsheet as
// plain rows, so the import rebuilds the store from exactly what the sheets hold.
// No label: the list of months. With a label: every tab of that month, header row first. Dates and times come out as
// text in the script's time zone ("2026-09-27", "2026-09-27 22:52:10"), never as instants that could shift a day.
// Left out: Sessions, and the Users password columns (the database has its own sign-in).
const EXPORT_LEFT_OUT_TABS = ['Sessions'];
const EXPORT_LEFT_OUT_COLUMNS = { Users: ['password_hash', 'salt'] };

function exportMonth(label) {
  const months = readTable(getControlSpreadsheet().getSheetByName('Months'))
    .map((m) => ({ label: normalizeMonthLabel(m.month_label), status: m.status, spreadsheetId: m.spreadsheet_id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const timeZone = Session.getScriptTimeZone();
  if (!label) return { timeZone, months: months.map(({ label: l, status }) => ({ label: l, status })) };
  const month = months.find((m) => m.label === label);
  if (!month) throw new ApiError('no_month', `There's no spreadsheet for ${label}.`);
  const spreadsheet = SpreadsheetApp.openById(month.spreadsheetId);
  const tabs = {};
  for (const name of Object.keys(MONTHLY_TABS)) {
    if (EXPORT_LEFT_OUT_TABS.includes(name)) continue;
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) continue; // Tabs added later (ShiftCloses) are missing from older months.
    const [headers, ...rows] = sheet.getDataRange().getValues();
    const drop = EXPORT_LEFT_OUT_COLUMNS[name] || [];
    const keep = headers.map((h, i) => i).filter((i) => !drop.includes(headers[i]));
    tabs[name] = [keep.map((i) => headers[i])].concat(rows
      .filter((row) => row.some((cell) => cell !== ''))
      .map((row) => keep.map((i) => exportCell(row[i], timeZone))));
  }
  return { timeZone, label, status: month.status, tabs };
}

// A date with no time of day is a date ("2026-09-27"); anything else keeps its time to the second.
function exportCell(value, timeZone) {
  if (Object.prototype.toString.call(value) !== '[object Date]') return value;
  const time = Utilities.formatDate(value, timeZone, 'HH:mm:ss');
  return Utilities.formatDate(value, timeZone, time === '00:00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
}
