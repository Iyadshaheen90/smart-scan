// Finds the month's spreadsheet that all reads and writes should go to.
// The Control spreadsheet (the one this script is bound to) lists every month in its Months tab.

const CURRENT_MONTH_CACHE_KEY = 'currentMonth';
const CURRENT_MONTH_CACHE_SECONDS = 300;

function getControlSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// Returns { label, spreadsheetId } for the month whose status is "active".
function getCurrentMonth() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CURRENT_MONTH_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const active = readTable(getControlSpreadsheet().getSheetByName('Months')).filter((m) => m.status === 'active');
  if (active.length !== 1) {
    throw new Error(`Expected exactly one active month in Months, found ${active.length}.`);
  }
  const month = { label: active[0].month_label, spreadsheetId: active[0].spreadsheet_id };
  cache.put(CURRENT_MONTH_CACHE_KEY, JSON.stringify(month), CURRENT_MONTH_CACHE_SECONDS);
  return month;
}

function openCurrentMonth() {
  return SpreadsheetApp.openById(getCurrentMonth().spreadsheetId);
}

function invalidateCurrentMonthCache() {
  CacheService.getScriptCache().remove(CURRENT_MONTH_CACHE_KEY);
}

function monthLabelFor(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM');
}

// Reads a tab into an array of objects keyed by its header row.
function readTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const [headers, ...rows] = values;
  return rows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}
