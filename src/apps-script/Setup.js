// One-time setup, run by hand from the Apps Script editor (select "setup", click Run).
// Safe to run again: it only creates what is missing.
//
// 1. Adds the Months tab to the Control spreadsheet (the one this script is bound to).
// 2. Creates the Template spreadsheet with every monthly tab and its headers.
// 3. Creates the first month's spreadsheet from the Template, seeds SlotConfig and SlotState,
//    and registers it as the active month.
// All files are kept in the same Drive folder as the Control spreadsheet.

const TEMPLATE_ID_PROPERTY = 'TEMPLATE_SPREADSHEET_ID';

function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const control = getControlSpreadsheet();
    const folder = DriveApp.getFileById(control.getId()).getParents().next();

    ensureTabs(control, CONTROL_TABS);
    const template = ensureTemplate(folder);
    const month = ensureFirstMonth(control, template, folder);

    invalidateCurrentMonthCache();
    Logger.log('Control:  %s', control.getUrl());
    Logger.log('Template: %s', template.getUrl());
    Logger.log('Month %s: %s', month.label, SpreadsheetApp.openById(month.spreadsheetId).getUrl());
  } finally {
    lock.releaseLock();
  }
}

function ensureTemplate(folder) {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(TEMPLATE_ID_PROPERTY);
  if (existingId && !DriveApp.getFileById(existingId).isTrashed()) {
    return SpreadsheetApp.openById(existingId);
  }

  const template = SpreadsheetApp.create('Smart Scan — Template');
  DriveApp.getFileById(template.getId()).moveTo(folder);
  ensureTabs(template, MONTHLY_TABS);
  props.setProperty(TEMPLATE_ID_PROPERTY, template.getId());
  return template;
}

function ensureFirstMonth(control, template, folder) {
  const monthsSheet = control.getSheetByName('Months');
  if (readTable(monthsSheet).length > 0) return getCurrentMonth();

  const label = monthLabelFor(new Date());
  const file = DriveApp.getFileById(template.getId()).makeCopy(`Smart Scan — ${label}`, folder);
  const month = SpreadsheetApp.openById(file.getId());
  seedSlots(month);

  appendMonthRow(monthsSheet, label, file.getId(), 'active');
  return { label, spreadsheetId: file.getId() };
}

// One SlotConfig row and one empty SlotState row per slot. SlotState rows are updated in place,
// so each gets a remaining_count formula (tickets count down to 0, so remaining = exposed + 1).
function seedSlots(month) {
  const config = [];
  for (const box of Object.keys(INITIAL_SLOT_PRICES)) {
    INITIAL_SLOT_PRICES[box].forEach((price, i) => config.push([Number(box), i + 1, price]));
  }
  month.getSheetByName('SlotConfig').getRange(2, 1, config.length, 3).setValues(config);

  const stateHeaders = MONTHLY_TABS.SlotState;
  const exposedCol = columnLetter(stateHeaders.indexOf('current_exposed_ticket_number') + 1);
  const state = config.map(([box, slot], i) => stateHeaders.map((h) => {
    if (h === 'box') return box;
    if (h === 'slot_number') return slot;
    if (h === 'remaining_count') return `=IF(${exposedCol}${i + 2}="","",${exposedCol}${i + 2}+1)`;
    return '';
  }));
  month.getSheetByName('SlotState').getRange(2, 1, state.length, stateHeaders.length).setValues(state);
}

// Creates any missing tabs with a bold, frozen header row, and removes the default empty "Sheet1".
function ensureTabs(spreadsheet, tabs) {
  for (const [name, headers] of Object.entries(tabs)) {
    if (spreadsheet.getSheetByName(name)) continue;
    const sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const blank = spreadsheet.getSheetByName('Sheet1');
  if (blank && !(blank.getName() in tabs) && blank.getLastRow() === 0) spreadsheet.deleteSheet(blank);
}

function columnLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
