// In-memory stand-ins for the Apps Script services the backend uses, shared by the Node test scripts.
// They behave like the real ones where the backend depends on it: a tab has a fixed number of
// rows (getRange past the last one throws), and the rows under a frozen header can't all be deleted.

// A tab whose header row is `headers` (or `old`, for a tab made before some columns existed).
function fakeSheet(headers, old, maxRows = 20) {
  const rows = [(old || headers).slice()];
  const width = () => rows[0].length;
  const sheet = {
    rows,
    getDataRange: () => ({ getValues: () => rows.map((r) => Array.from({ length: width() }, (_, i) => r[i] ?? '')) }),
    getLastRow: () => rows.length, getLastColumn: () => width(),
    getMaxRows: () => maxRows,
    insertRowsAfter(after, n) { maxRows += n; }, // only ever called with after = getMaxRows()
    deleteRows(r, n) {
      if (maxRows - n <= 1) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
      rows.splice(r - 1, n); maxRows -= n;
    },
    deleteRow(r) { sheet.deleteRows(r, 1); },
    setFrozenRows() {},
    getRange: (r, c, nr, nc) => nr ? {
      getValues: () => [rows[0].slice(c - 1, c - 1 + nc)],
      setValues([v]) { v.forEach((x, i) => { rows[0][c - 1 + i] = x; }); return this; },
      setFontWeight() { return this; },
    } : {
      setNumberFormat() { return this; },
      setValue(v) {
        if (r > maxRows) throw new Error('The starting row of the range is too large.');
        (rows[r - 1] ||= []); rows[r - 1][c - 1] = v; return this;
      },
    },
    appendRow(values) { rows.push(values.slice()); if (rows.length > maxRows) maxRows = rows.length; },
    copy: () => fakeSheet(rows[0], null, maxRows).fill(rows),
    fill(from) { rows.splice(0, rows.length, ...from.map((r) => r.slice())); return sheet; },
  };
  return sheet;
}

function fakeSpreadsheet(id, tabs) {
  return {
    tabs,
    getId: () => id,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
    getSheetByName: (name) => tabs[name] || null,
    insertSheet(name) { tabs[name] = fakeSheet([]); tabs[name].rows[0] = []; return tabs[name]; },
    deleteSheet() {},
  };
}

// Drive holding the Control spreadsheet (with a Months tab) and the given month spreadsheets, all
// in one folder ("root") unless moved, plus other folders (addFolder), script properties, and
// SpreadsheetApp and CacheService over them.
function fakeGoogle(control) {
  const files = {};
  const folders = {};
  const props = {};
  let nextId = 1;
  function addFolder(id, name) {
    folders[id] = {
      id, name, trashed: false,
      getId: () => id,
      getName: () => folders[id].name,
      isTrashed: () => folders[id].trashed,
      getFilesByName(fileName) {
        const found = Object.values(files).filter((f) => f.name === fileName && !f.trashed && f.folder === id).map(fileApi);
        return { hasNext: () => found.length > 0, next: () => found.shift() };
      },
    };
    return folders[id];
  }
  const iterator = (list) => ({ hasNext: () => list.length > 0, next: () => list.shift() });
  addFolder('root', 'My Drive folder');
  function add(name, spreadsheet, folder = 'root') {
    files[spreadsheet.getId()] = { name, spreadsheet, trashed: false, folder };
    return spreadsheet;
  }
  function fileApi(f) {
    return {
      getId: () => f.spreadsheet.getId(),
      getName: () => f.name,
      getMimeType: () => 'application/vnd.google-apps.spreadsheet',
      getParents: () => iterator([folders[f.folder]]),
      setTrashed(v) { f.trashed = v; },
      isTrashed: () => f.trashed,
      moveTo(folder) { f.folder = folder.getId(); return this; },
      makeCopy(name, folder) {
        const id = `copy${nextId++}`;
        const tabs = Object.fromEntries(Object.entries(f.spreadsheet.tabs).map(([n, s]) => [n, s.copy()]));
        add(name, fakeSpreadsheet(id, tabs), folder ? folder.getId() : f.folder);
        return fileApi(files[id]);
      },
    };
  }
  add('Smart Scan Control', control);
  const cache = new Map();
  return {
    files, folders, props, add, addFolder,
    DriveApp: {
      getFileById: (id) => fileApi(files[id]),
      getFolderById: (id) => { if (!folders[id]) throw new Error('No item with the given ID could be found'); return folders[id]; },
      // Only the query moveMonthsToFolder sends: folders whose name contains the quoted text.
      searchFolders: (q) => {
        const text = q.match(/contains '([^']+)'/)[1].toLowerCase();
        return iterator(Object.values(folders).filter((f) => !f.trashed && f.name.toLowerCase().includes(text)));
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Logger: { log() {} },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    SpreadsheetApp: { openById: (id) => files[id].spreadsheet, getActiveSpreadsheet: () => control, flush() {} },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
  };
}

module.exports = { fakeSheet, fakeSpreadsheet, fakeGoogle };
