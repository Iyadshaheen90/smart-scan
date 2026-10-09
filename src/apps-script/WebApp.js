// Web App entry points. Pages on GitHub Pages call doPost with a JSON body sent as text/plain
// (which avoids a CORS preflight): { action, token, ...params }. Every response is JSON:
// { ok: true, data } or { ok: false, code, error }.

// Actions anyone can call.
const PUBLIC_ACTIONS = {
  login: (req) => login(req.username, req.password),
  logout: (req) => logout(req.token),
  claimOwner: (req) => claimOwner(req.setupCode, req.username, req.password),
};

// Actions that need a signed-in user; `owner: true` also requires the owner role, and `allow: [...]`
// the owner or an employee with one of those permissions (each action checks the exact one it needs).
const SIGNED_IN_ACTIONS = {
  me: { run: (req, user) => user },
  changePassword: { run: (req, user) => changeOwnPassword(user, req.currentPassword, req.newPassword) },
  listUsers: { owner: true, run: () => listUsers() },
  createUser: { owner: true, run: (req) => createUser(req.username, req.password, req.role) },
  setUserActive: { owner: true, run: (req, user) => setUserActive(user, req.username, req.active) },
  setUserPermissions: { owner: true, run: (req) => setUserPermissions(req.username, req.permissions) },
  resetPassword: { owner: true, run: (req) => resetPassword(req.username, req.newPassword) },
  listSlots: { run: () => listSlots() },
  activatePack: { allow: ['load_packs'], run: (req, user) => activatePack(user, req) },
  endPack: { allow: ['load_packs', 'return_packs'], run: (req, user) => endPack(user, req) },
  undoActivation: { allow: ['load_packs'], run: (req, user) => undoActivation(user, req) },
  undoEndPack: { allow: ['load_packs', 'return_packs'], run: (req, user) => undoEndPack(user, req) },
  swapSlots: { owner: true, run: (req) => swapSlots(req) },
  closeStatus: { run: (req, user) => closeStatus(user) },
  ownerHome: { owner: true, run: (req, user) => ownerHome(user) },
  submitClose: { run: (req, user) => submitClose(user, req.entries, req.closeId, req.date) },
  reopenClose: { owner: true, run: () => reopenClose() },
  shiftStatus: { run: (req, user) => shiftStatus(user) },
  submitShiftClose: { run: (req, user) => submitShiftClose(user, req.entries, req.shiftId, req.date) },
  listShiftCloses: { owner: true, run: (req, user) => listShiftCloses(user) },
  deleteShiftClose: { owner: true, run: (req, user) => deleteShiftClose(user, req) },
  setPackSize: { owner: true, run: (req) => setPackSize(req) },
  listBackStock: { allow: ['receive_shipments', 'count_stock', 'full_pack_sale'], run: (req, user) => withoutDollars(user, listBackStock()) },
  saveBackStock: { allow: ['receive_shipments', 'count_stock'], run: (req, user) => withoutDollars(user, saveBackStock(user, req.mode, req.lines, req.notes)) },
  removeBackStock: { owner: true, run: (req, user) => removeBackStock(user, req) },
  adjustBackStock: { owner: true, run: (req, user) => adjustBackStock(user, req) },
  sellFullPack: { allow: ['full_pack_sale'], run: (req, user) => withoutDollars(user, sellFullPack(user, req)) },
  undoFullPackSale: { owner: true, run: (req) => undoFullPackSale(req) },
  listFullPackSales: { owner: true, run: () => listFullPackSales() },
  endGame: { owner: true, run: (req) => endGame(req.gameNumber) },
  bringBackGame: { owner: true, run: (req) => bringBackGame(req.gameNumber) },
  setSlotPrice: { owner: true, run: (req) => setSlotPrice(req) },
  setSlotOrder: { allow: ['ticket_order'], run: (req, user) => setSlotOrder(user, req) },
  setAllSlotsOrder: { allow: ['ticket_order'], run: (req, user) => setAllSlotsOrder(user, req) },
  monthStatus: { owner: true, run: () => monthStatus() },
  startNewMonth: { owner: true, run: (req) => startNewMonth(req) },
  listMonths: { owner: true, run: () => listMonths() },
  monthSummary: { owner: true, run: (req) => monthSummary(req.label) },
  monthsPage: { owner: true, run: () => monthsPage() },
};

function doPost(e) {
  // Nothing kept from an earlier request (the month may have been started since).
  currentMonthMemo = null;
  openedMonth = null;
  try {
    let req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (err) {
      throw new ApiError('bad_request', 'Request body must be JSON.');
    }

    if (PUBLIC_ACTIONS[req.action]) {
      return json({ ok: true, data: PUBLIC_ACTIONS[req.action](req) });
    }
    const action = SIGNED_IN_ACTIONS[req.action];
    if (!action) throw new ApiError('unknown_action', `Unknown action "${req.action}".`);
    const user = requireSession(req.token, action.owner ? 'owner' : undefined);
    if (action.allow && !action.allow.some((p) => can(user, p))) {
      throw new ApiError('forbidden', 'The owner hasn\'t turned this on for you.');
    }
    return json({ ok: true, data: action.run(req, user) });
  } catch (err) {
    if (err instanceof ApiError) return json({ ok: false, code: err.code, error: err.message });
    console.error(err);
    return json({ ok: false, code: 'server_error', error: String(err && err.message ? err.message : err) });
  }
}

// Health check, used to confirm the deployed URL works from a phone.
function doGet() {
  try {
    const month = getCurrentMonth();
    const slots = readTable(openCurrentMonth().getSheetByName('SlotConfig')).length;
    return json({ ok: true, app: 'smart-scan', month: month.label, slots });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Employees never see dollar amounts: drops back stock value and a full pack's sale price from an answer.
function withoutDollars(user, data) {
  if (user.role === 'owner') return data;
  const strip = (g) => { const { valueInBack, ...rest } = g; return rest; };
  if (Array.isArray(data)) return data.map(strip);
  const { dollars, ...rest } = data;
  if (rest.backStock) rest.backStock = rest.backStock.map(strip);
  return rest;
}

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
