// Finds the month's spreadsheet that all reads and writes should go to.
// The Control spreadsheet (the one this script is bound to) lists every month in its Months tab.

const CURRENT_MONTH_CACHE_KEY = 'currentMonth:v2';
const CURRENT_MONTH_CACHE_SECONDS = 300;

function getControlSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// Returns { label, spreadsheetId } for the month whose status is "active". Start New Month marks
// the new month active before archiving the old one, so for a moment two can be: the later wins.
function getCurrentMonth() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CURRENT_MONTH_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const active = readTable(getControlSpreadsheet().getSheetByName('Months'))
    .filter((m) => m.status === 'active')
    .map((m) => ({ label: normalizeMonthLabel(m.month_label), spreadsheetId: m.spreadsheet_id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (active.length === 0) throw new Error('No active month in Months.');
  const month = active.pop();
  cache.put(CURRENT_MONTH_CACHE_KEY, JSON.stringify(month), CURRENT_MONTH_CACHE_SECONDS);
  return month;
}

function openCurrentMonth() {
  return SpreadsheetApp.openById(getCurrentMonth().spreadsheetId);
}

function invalidateCurrentMonthCache() {
  CacheService.getScriptCache().remove(CURRENT_MONTH_CACHE_KEY);
}

function spreadsheetUrl(id) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function monthLabelFor(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM');
}

// Sheets turns a typed "2026-09" into a date (midnight on the 1st, in some time zone), so a
// label may come back as a Date. Midnight anywhere from UTC-12 to UTC+12 falls within 12 hours
// of midnight UTC, so shifting by 12 hours and reading in UTC always lands on the 1st.
function normalizeMonthLabel(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(new Date(value.getTime() + 12 * 3600 * 1000), 'UTC', 'yyyy-MM');
  }
  return String(value);
}

// Appends a Months row, storing the label as plain text so Sheets doesn't turn it into a date.
function appendMonthRow(monthsSheet, label, spreadsheetId, status) {
  monthsSheet.appendRow([label, spreadsheetId, new Date(), status]);
  monthsSheet.getRange(monthsSheet.getLastRow(), 1).setNumberFormat('@').setValue(label);
}

function nextMonthLabel(label) {
  const [year, month] = label.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// "2026-10" -> "October 2026"
function monthName(label) {
  const [year, month] = label.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// --- Start New Month (owner only) ---
//
// The owner starts each month on or after the 1st (never automatically, so it can't happen in
// the middle of a close). The new spreadsheet is a copy of the current one, so everything
// physically in the store carries over exactly: slot prices, live packs, back stock, logins and
// sign-ins. Its log tabs are then emptied, except rows already dated in the new month (a pack
// sold out after the old month's last close, or closes done before anyone started the new
// month): those move out of the old spreadsheet into the new one, so starting late loses
// nothing. The old month's spreadsheet stays in Drive, marked archived in Months.

// What the Start New Month screen needs.
function monthStatus() {
  const current = getCurrentMonth();
  const next = nextMonthLabel(current.label);
  return {
    current: current.label,
    currentUrl: spreadsheetUrl(current.spreadsheetId),
    next,
    canStart: todayLabel() >= `${next}-01`,
  };
}

// req.label is the month the owner confirmed, so a second tap can't start the month after it.
function startNewMonth(req) {
  return withLock(() => {
    invalidateCurrentMonthCache();
    const current = getCurrentMonth();
    const label = nextMonthLabel(current.label);
    const control = getControlSpreadsheet();
    const monthsSheet = control.getSheetByName('Months');
    const started = readTable(monthsSheet).map((m) => normalizeMonthLabel(m.month_label));
    if (started.includes(req.label)) {
      throw new ApiError('already_started', `${monthName(req.label)} has already been started.`);
    }
    if (req.label !== label) {
      throw new ApiError('bad_request', `The next month to start is ${monthName(label)}. Reload and try again.`);
    }
    if (todayLabel() < `${label}-01`) {
      throw new ApiError('too_early', `${monthName(label)} can be started from ${monthName(label).replace(' ', ' 1, ')}.`);
    }

    // A copy left by an earlier attempt that failed partway was never registered, so nothing used it.
    const folder = DriveApp.getFileById(control.getId()).getParents().next();
    const name = `Smart Scan — ${label}`;
    const leftovers = folder.getFilesByName(name);
    while (leftovers.hasNext()) {
      const file = leftovers.next();
      if (file.getMimeType() === MimeType.GOOGLE_SHEETS) file.setTrashed(true);
    }

    SpreadsheetApp.flush();
    const id = DriveApp.getFileById(current.spreadsheetId).makeCopy(name, folder).getId();
    const month = SpreadsheetApp.openById(id);
    ensureTabs(month, MONTHLY_TABS);
    const inNewMonth = (column) => (row) => (dateLabel(row[column]) || '') >= `${label}-01`;
    for (const [tab, column] of Object.entries(MONTHLY_LOG_DATE_COLUMNS)) {
      deleteRowsWhere(month.getSheetByName(tab), (row) => !inNewMonth(column)(row));
    }

    // Active before the old month is archived, so there is never a moment with no active month.
    appendMonthRow(monthsSheet, label, id, 'active');
    updateRowsWhere(monthsSheet, (m) => m.spreadsheet_id === current.spreadsheetId, { status: 'archived' });
    invalidateCurrentMonthCache();

    const old = SpreadsheetApp.openById(current.spreadsheetId);
    const moved = {};
    for (const [tab, column] of Object.entries(MONTHLY_LOG_DATE_COLUMNS)) {
      moved[tab] = deleteRowsWhere(old.getSheetByName(tab), inNewMonth(column));
    }
    return { label, previous: current.label, url: spreadsheetUrl(id), moved };
  });
}

// --- Monthly totals (owner only) ---

// Every month, newest first.
function listMonths() {
  return readTable(getControlSpreadsheet().getSheetByName('Months'))
    .map((m) => ({ label: normalizeMonthLabel(m.month_label), status: m.status, url: spreadsheetUrl(m.spreadsheet_id) }))
    .sort((a, b) => b.label.localeCompare(a.label));
}

// A month's totals, worked out from its own DailySummary rows (like the Excel Summary tab), so they
// can't drift from the days they come from. Ending inventory is the last closed day's, not a sum.
function monthSummary(label) {
  const month = readTable(getControlSpreadsheet().getSheetByName('Months'))
    .find((m) => normalizeMonthLabel(m.month_label) === label);
  if (!month) throw new ApiError('no_month', `There's no spreadsheet for ${label}.`);
  const spreadsheet = SpreadsheetApp.openById(month.spreadsheet_id);
  const days = readTable(spreadsheet.getSheetByName('DailySummary'))
    .map((d) => ({
      date: dateLabel(d.close_date),
      ticketsSold: Number(d.total_tickets_sold),
      dollarsSold: Number(d.total_dollars_sold),
      inventoryValue: Number(d.total_inventory_value),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const shipments = readTable(spreadsheet.getSheetByName('Shipments'));
  const sum = (rows, f) => rows.reduce((total, r) => total + (Number(f(r)) || 0), 0);
  return {
    label,
    status: month.status,
    url: spreadsheetUrl(month.spreadsheet_id),
    days,
    ticketsSold: sum(days, (d) => d.ticketsSold),
    dollarsSold: sum(days, (d) => d.dollarsSold),
    shipmentValue: sum(shipments, (s) => s.tickets_received * s.price_per_ticket),
    endingInventoryValue: days.length ? days[days.length - 1].inventoryValue : null,
  };
}
