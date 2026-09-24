// Small helpers for treating a tab as a table of objects keyed by its header row.

// Reads a tab into an array of objects, skipping blank rows.
function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const [headers, ...rows] = values;
  return rows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
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

// Deletes every row matching `predicate`, bottom-up so row numbers stay valid.
function deleteRowsWhere(sheet, predicate) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const obj = Object.fromEntries(headers.map((h, j) => [h, rows[i][j]]));
    if (predicate(obj)) sheet.deleteRow(i + 2);
  }
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
