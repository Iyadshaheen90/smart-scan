// Web App entry points. Pages on GitHub Pages call doPost with a JSON body sent as text/plain
// (which avoids a CORS preflight): { action, token, ...params }. Every response is JSON:
// { ok: true, data } or { ok: false, code, error }.

// Actions anyone can call.
const PUBLIC_ACTIONS = {
  login: (req) => login(req.username, req.password),
  logout: (req) => logout(req.token),
  claimOwner: (req) => claimOwner(req.setupCode, req.username, req.password),
};

// Actions that need a signed-in user; `owner: true` also requires the owner role.
const SIGNED_IN_ACTIONS = {
  me: { run: (req, user) => user },
  changePassword: { run: (req, user) => changeOwnPassword(user, req.currentPassword, req.newPassword) },
  listUsers: { owner: true, run: () => listUsers() },
  createUser: { owner: true, run: (req) => createUser(req.username, req.password, req.role) },
  setUserActive: { owner: true, run: (req, user) => setUserActive(user, req.username, req.active) },
  resetPassword: { owner: true, run: (req) => resetPassword(req.username, req.newPassword) },
  listSlots: { run: () => listSlots() },
  activatePack: { owner: true, run: (req, user) => activatePack(user, req) },
  endPack: { run: (req, user) => endPack(user, req) },
  undoActivation: { owner: true, run: (req, user) => undoActivation(user, req) },
  undoEndPack: { owner: true, run: (req) => undoEndPack(req) },
  swapSlots: { owner: true, run: (req) => swapSlots(req) },
  closeStatus: { run: (req, user) => closeStatus(user) },
  submitClose: { run: (req, user) => submitClose(user, req.entries) },
  reopenClose: { owner: true, run: () => reopenClose() },
  setPackSize: { owner: true, run: (req) => setPackSize(req) },
  listBackStock: { owner: true, run: () => listBackStock() },
  saveBackStock: { owner: true, run: (req, user) => saveBackStock(user, req.mode, req.lines, req.notes) },
  removeBackStock: { owner: true, run: (req, user) => removeBackStock(user, req) },
  setSlotPrice: { owner: true, run: (req) => setSlotPrice(req) },
};

function doPost(e) {
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

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
