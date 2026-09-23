// Web App entry points. For now doGet is only a health check, used to confirm the deployed
// URL works from a phone; the real API arrives with the login and flow build steps.

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
