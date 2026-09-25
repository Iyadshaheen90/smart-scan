// Small helpers for treating a tab as a table of objects keyed by its header row.

// Reads a tab into an array of objects, skipping blank rows.
function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const [headers, ...rows] = values;
  return rows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

// Adds any of `headers` missing from the header row, at the end, so tabs made before a column
// existed pick it up without moving the columns (or formulas) already there.
function ensureHeaders(sheet, headers) {
  const existing = headersOf(sheet);
  const missing = headers.filter((h) => !existing.includes(h));
  if (missing.length === 0) return;
  sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
}

function headersOf(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

// Sheets reads typed text like "007" as a number and "=..." as a formula, so string values are
// written into plain-text cells to be stored exactly as given. Clearing a cell ('') leaves its format.
function setCell(range, value) {
  if (typeof value === 'string' && value !== '') range.setNumberFormat('@');
  range.setValue(value);
}

function appendObject(sheet, obj) {
  const headers = headersOf(sheet);
  const row = sheet.getLastRow() + 1;
  // A new tab has 1000 rows and getRange can't reach past the last one (a month of closes is ~1500 rows).
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
  headers.forEach((h, i) => {
    if (h in obj) setCell(sheet.getRange(row, i + 1), obj[h]);
  });
}

// Applies `changes` to every row matching `predicate`. Returns how many rows changed.
function updateRowsWhere(sheet, predicate, changes) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  let count = 0;
  rows.forEach((row, i) => {
    const obj = Object.fromEntries(headers.map((h, j) => [h, row[j]]));
    if (!predicate(obj)) return;
    for (const [key, value] of Object.entries(changes)) {
      setCell(sheet.getRange(i + 2, headers.indexOf(key) + 1), value);
    }
    count += 1;
  });
  return count;
}

// Deletes every row matching `predicate` and returns how many. Works bottom-up so row numbers
// stay valid, deleting each run of neighbouring rows in one call (clearing a month of log rows
// one at a time would take minutes).
function deleteRowsWhere(sheet, predicate) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const matches = rows.map((row) => predicate(Object.fromEntries(headers.map((h, j) => [h, row[j]]))));
  const count = matches.filter(Boolean).length;
  // Sheets won't delete every row under the frozen header, so keep a blank row below the data.
  if (count > 0 && rows.length + 1 >= sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  for (let end = matches.length - 1; end >= 0; end--) {
    if (!matches[end]) continue;
    let start = end;
    while (start > 0 && matches[start - 1]) start -= 1;
    sheet.deleteRows(start + 2, end - start + 1);
    end = start;
  }
  return count;
}

// Runs fn while holding the script-wide lock, so concurrent writes can't interleave.
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
