# Smart Scan

Scratcher (California Lottery instant ticket) tracking for Route 66 Liquor. Phone-first web app:
static pages on GitHub Pages, backend in Google Apps Script, data in Google Sheets.

- Live app: https://iyadshaheen90.github.io/smart-scan/src/index.html (Pages serves the repo root, so pages live under `/src/`)
- Backend URL: `SMART_SCAN_API_URL` in `src/config.js` (one Web App deployment, updated in place so the URL never changes)
- Control spreadsheet (script is bound to it): `1vw4smk5W-bxgatatQzb71rE0tbOLe9g0Ed88Nyn1PZA`
- Progress, decisions and what's next: the plan file `~/.claude/plans/smart-scan-plan-sorted-nebula.md`,
  section "▶ PROGRESS — pick up here". Read it first.

## Store layout and ticket facts

- 2 boxes × 24 slots = 48 slots. Each slot has a price tier (`SlotConfig`); seeded from `INITIAL_SLOT_PRICES`.
- **Ticket order per slot** (owner 2026-10-08): **descending** (last ticket → 000; Route 66 Liquor, every slot today) or
  **ascending** (000 → last). The top ("exposed") ticket is always the next unsold one, so descending: left = top + 1,
  sold = last − now; ascending: left = pack size − top, sold = now − last; an already-sold ticket is above the last top
  ticket (descending) or below it (ascending). All of it goes through `Tickets.js` (`orderOf`, `ticketsLeft`,
  `ticketsSold`, `alreadySold`, `soldSide`, `packSizeFinder`/`sizeFor`) and the pages' copy in api.js (`ticketsSold`,
  `ticketsLeftAt`, `alreadySold`, `soldSide`, `orderName`, `orderIcon`) — never hard-code "+ 1" again.
  The setting is `SlotConfig.ticket_order`; a pack copies it at activation (`SlotState.ticket_order`, then
  `PackHistory.ticket_order` so `undoEndPack` restores it) and is always counted its own way. Blank = descending
  (sheets from before it). A slot's order changes only while it's empty (`setSlotOrder`, slot page; owner's choice), or
  for all slots on More (`setAllSlotsOrder`: empty slots now, a slot with a pack from its next pack). Swap/move carries it
  like the price tier. Slots shows ↓/↑ on the right of every card (everyone): the pack's order, or the slot's for an empty
  one. Speed: the pack size is read only for ascending packs (`packSizeFinder` reads ReserveInventory lazily or reuses
  a copy), so an all-descending store does no extra sheet reads. `remaining_count` (`remainingFormula`) handles both;
  existing rows got the new formula when `ticket_order` was first added (`slotStateSheet` → `refreshRemainingFormulas`).
  A full pack sale has no slot and stays descending.
- Standard pack sizes by price (`STANDARD_PACK_SIZES`, kept in both `Schema.js` and `barcode.js`):
  $40/$30/$20 → 30, $10 → 50, $5 → 80, $3/$2 → 100, $1 → 240.
- Ticket back barcode: 26-digit ITF `GGGG PPPPPPP TTT 000000000 XXX` (game, pack, ticket). Printed
  `GGGG-PPPPPPP-C-TTT`; the check digit C isn't in the barcode. See `src/barcode.js`.
- The store closes at **11 pm** (owner, 2026-09-26), so every close is before midnight. See "Days" below.

## Business rules

**Roles** (enforced server-side with `owner: true` / `allow: [...]` in `WebApp.js`, and hidden in the UI)
- Employees: Close Day (where they mark packs **Sold out**) and a view-only Slots page. Nothing else unless the owner
  turns on a permission for them (below) — by default `endPack` outside Close Day is owner-only (owner's choice
  2026-09-25: one place to mark sold out, fewer mis-taps).
- Owner: activate packs, returns, all undos, slot prices, pack sizes, move/swap, back stock (including its
  **Find a game** search and **Game ended**; owner's choice 2026-09-26: no employee version), reopen a close,
  months, employees, the Settling list.
- Employees never see dollar totals (`summaryFor` strips them).
- **Employee permissions** (owner's request 2026-10-08, e.g. while travelling): on Manage employees the owner turns on,
  per employee, any of `PERMISSIONS` (`Permissions.js`): **load_packs** (slot page: Sold out + put a pack in, incl. a new
  game's price and changing the slot price to fit; undo a wrong slot; put back a pack marked *sold out* today),
  **return_packs** (Returned, and putting back a returned pack), **receive_shipments** (Back stock shipment mode only),
  **count_stock** (Manage Stock), **full_pack_sale** (sell only; Undo stays the owner's), **ticket_order** (a slot's
  Ticket order on the slot page while it's empty, and Ticket order for all slots on More), **theft_report** (the Theft
  Report, without $; owner 2026-10-23). Saved as a comma list in
  `Users.permissions` (column added on first save, `ensureHeaders`); `setUserPermissions` (owner). The router's
  `allow: [...]` lets in the owner or an employee with one of them; each function checks the exact one (`can`,
  `requirePermission`, `requireEndPermission`). Never $ for employees: `withoutDollars` strips `valueInBack`/`dollars`;
  pages hide Find a game, the back stock list and $ amounts. Search, Manage packs, Game ended, slot price/pack size/swap,
  reports stay owner-only. The session carries `permissions` (login); `closeStatus.permissions` refreshes it on the
  employee home, which shows an "Also Allowed" link per permission. Slots cards are tappable with load/return/ticket order.

**Inventory**
- Back stock = `ReserveInventory` (packs in the back). Live = packs in slots (`SlotState`).
- Activating a pack takes one pack out of back stock (never below 0; `took_from_reserve` records whether it did)
  but it is still inventory. Total inventory value = live remaining × price + back stock tickets × price.
- Empty slot = "out of stock": adds nothing to sales or inventory; back stock untouched. It shows the packs in back
  of the game last in it (`SlotState.last_game_number`, set when a pack sells out or is returned; falls back to this
  month's PackHistory) on Slots and the slot page (not in Close Day), unless that game has ended.
- **Days since activation** (owner only, Slots page only; owner's choice 2026-09-27): each live slot shows a yellow
  "Activated Today" / "N Days" under its green "N Left" (`listSlots` → `pack.daysActive`, from
  `SlotState.activation_date` to `todayLabel()`; day 0 = activation day). From day 50 (`OLD_PACK_DAYS`, api.js) a yellow `!`
  badge sits on the slot card's top-left corner (not before the name, so the name isn't indented; owner 2026-09-30): CA Lottery settles (charges the store for) a pack 50–60 days after activation, so old
  slow packs get pushed. It keeps counting until the pack sells out or is returned; a swap/move and a new month keep it.
  **Activation Date** (owner only, slot page under Pack Size; owner 2026-10-26): a slow pack left in the back long enough
  is activated by the lottery on its own, months before it goes in a slot, so its settling clock started earlier. The owner
  sets that day (`setActivationDate { box, slot, date }`: a real day from 365 days ago to today, a slot with a pack) and it
  replaces `SlotState.activation_date` (database: `packs.activated_on`). Only the days counter reads that date (Slots, the
  day-50 mark, Settling, PackHistory's copy); sales and the Theft Report count from tickets. Close Day's
  `late_activation` log flag then reads false for that pack (nothing reads the flag). A wrong date: set it again.
  The same packs (50+ days) are listed on the owner's **Settling** page, red from day 60 (owner approved 2026-09-29).
- Back stock changes and where they're logged: Shipment received (source "delivery") and **Manage packs** (+) (source
  "add pack", owner approved 2026-09-27) → `Shipments` (both count in the month's "Shipments in"); Manage Stock (count) and Manage packs (−)
  → `ReserveAdjustments` (reason count / returned, game expired, damaged, stolen, other; "adjust" only from the API).
- **Full pack sale** (owner only, 2026-09-30): a customer buys a whole sealed pack from the back. The owner scans a ticket of
  it (pack number needed), and `sellFullPack` takes one pack off `ReserveInventory` (refused with 0 in the back, for a pack
  live in a slot, or one already in PackHistory). It logs a `DailyCloseLog` row (`close_type 'full_pack'`, no box/slot,
  whole pack × price, dated `salesDate()`), so it is in that day's totals, plus a PackHistory row (`end_reason
  'full_pack_sale'`) so the pack can't be activated later. Not a ReserveAdjustment (it's a sale). Also shown on its own:
  the owner home's Full pack sales card (this month's count and $) and `full-packs.html`. Each month's list starts empty
  (log rows stay in their month); back stock carries over. Limit, same as activation: a pack sold last month isn't
  checked against this month's sales.
- A game's `ReserveInventory` row is also where its price and pack size are remembered, so rows are never deleted.
- **Game ended** (CA Lottery stopped the game): the owner hides it with `endGame`, allowed only with 0 packs in the
  back and none in a slot. It sets `ReserveInventory.ended_date`; the row stays, carries into each new month, and
  is listed under "Ended games" (Bring back = `bringBackGame`). Receiving or counting it, or activating a pack of
  it, clears `ended_date` by itself. Never automatic: only the owner decides a game has ended.

**Sales**
- Close Day: sold = last top ticket − today's top ticket. A pack activated today counts from its activation ticket.
- Ending a pack logs sales immediately in `DailyCloseLog`: sold out = all remaining; returned = tickets above the
  scanned top ticket (the rest go back). Close type `sold_out` / `returned`; Close Day rows are `close`.
- Day totals (`DailySummary`) = every `DailyCloseLog` row dated **after the previous close up to that day** (`buildSummary`,
  `lastCloseBefore`), so mid-day sold-outs are included, and a day nobody closed has its sold outs, returns and full pack
  sales counted by the next close (owner 2026-10-26; its scanned sales already were, since tickets count from the last
  close). A full pack sale's Undo stops once any close has counted it (`coveredByClose`: a close on that day or later).
- **Close Yesterday** (owner 2026-10-26: a broken or forgotten phone; owner **and** employees): the morning after a day
  nobody closed, until **12:00 PM** (`CLOSE_YESTERDAY_UNTIL`), that day can be closed late: `close.html?yesterday=1` (own
  draft `smartScanLateDraft:<user>`) → `submitClose { late: true, date: yesterday }`, saved under yesterday (close rows,
  `last_close_date`, summary; a slot marked Sold out in it ends yesterday: `endPackInSlot(..., onDate)`). Refused
  (`too_late`) once today is closed, from noon, on Sheets when yesterday is in last month's finished spreadsheet, or once
  something changed today (`changedToday`: a pack put in today, any log row dated today — sold out / returned / full pack —
  or a shift close today), since those would mix today's sales into yesterday's. `closeStatus.closeYesterday` (so also
  `ownerHome`) = `{ date, until, blocked }` while it applies (blocked = the reason, else null), `{ date, until, closed }` for
  this morning's late close, else null. Home shows an amber **Close Yesterday · Mon, Oct 26** button (both roles; owner from
  a fresh answer only) with a note, or just the note with the reason when blocked; Close Day shows a banner linking to it.
  A late close's summary has `closedLate` ("Submitted the next morning at 9:00 AM by e", "sold that day"). The owner can
  reopen it (`reopenClose { date: yesterday }`) on the same terms; an on-time close of yesterday can't be reopened.
  The unsent-close queue carries `late`. Nothing changes if nobody uses it: tonight's close then counts both days.
- A pack ended **after** today's close is logged to the next day (`salesDate()`).
- One close per day (`already_closed`); the owner can reopen it (`reopenClose`).
- **Shift close** (optional; owner's request 2026-09-30; `Shifts.js`, `close.html?shift=1`): whoever ends a shift scans
  every live slot (same screen as Close Day, titled Close shift). Only that shift's numbers are saved (`ShiftCloses` +
  `ShiftCloseLog`, created on first use in a month sheet without them), for the owner to compare with the register by
  hand; the app judges nothing. It **never** writes SlotState, DailyCloseLog or DailySummary: Close Day still counts the
  whole day from last night's close, and Slots / home $ on display / Settling keep showing last night's top tickets
  (owner's choices). Shift start ticket = the pack's ticket at today's last shift close, else SlotState (last close or
  activation ticket). Sold out at a shift close counts every ticket left that shift but doesn't end the pack; later shift
  closes that day fill it in as "sold out · 0" (no scan); the night Close Day is **not** pre-filled (tap Sold out again,
  owner's choice). Packs ended and full packs sold during a shift count in it (DailyCloseLog rows by the new `logged_at`,
  less what an earlier shift close already counted). Employees: one shift close a day **per username** (`already_closed_shift`;
  each person signs in as themselves, so several employees can each close one the same day) unless the owner deletes it; tickets only, no $. Owner: no limit, sees $. None after the day is closed. No offline queue:
  with no connection it says so and the scans stay in the phone's draft (`smartScanShiftDraft:<user>`, tied to the
  previous shift close). Repeated `shiftId` = the saved shift back. Owner deletes a mistaken one on `shifts.html`.
- **Sending a close** (offline queue): Submit saves the close on the phone with a `closeId`, then sends it. With no
  connection it waits as "saved, not sent yet" and is resent (every 30s, when back online, when the app comes back
  to the front, and from the home page). The server answers a repeated `closeId` with the close it already saved
  (`DailySummary.close_id`), so a lost answer never saves it twice. A close dated before today is refused
  (`wrong_day`) rather than saved as the next day, which would block that night's close; its sales count in the
  next close. Any refusal drops the saved close and returns to the scans (the draft is kept).

**Days**
- A "day" is the calendar date in the script time zone (`todayLabel()`). Right while the store closes at 11 pm.
- It may close as late as 2 am in future years. Before then, a day must end after closing time (e.g. 4 am) in
  `todayLabel()`, `salesDate()`, the phone's draft and `wrong_day` date, and Start New Month, or a 1 am close lands
  on the wrong day (and a Sep 30 close at 1 am would count in October). Future stores may each close at a
  different hour, so this becomes a per-store setting then.

**Mistake recovery** (the owner tests by making deliberate mistakes — every action needs a way back)
- Wrong-slot activation → `undoActivation` until the slot's first close: slot empties, old slot price comes
  back (`price_before_activation`), pack returns to back stock only if it came from there.
- Pack wrongly marked sold out/returned → `undoEndPack`, while the slot is still empty and that sales day
  isn't closed. If a replacement went in, undo that activation first.
- Swap/move is its own undo (swap the same two slots again).
- Wrong activation date → set it again on the slot page (`setActivationDate`).
- Close Yesterday done wrong → the owner reopens it on Close Yesterday (before noon, today not closed).
- Wrong pack size → `setPackSize` (refused if a live pack's top ticket wouldn't fit). Wrong slot price → `setSlotPrice`.
- Wrong close → `reopenClose` restores every top ticket (found by pack, so moves after the close are fine).
- Close submitted by mistake while still unsent → "Stop sending and change scans" on Close Day.
- Shift close made by mistake → Delete on the Shift Closure page (`deleteShiftClose`): later shift closes that day start
  from the one before it, and that employee can close their shift again.
- Full pack sold by mistake → Undo on the Full pack sales page (`undoFullPackSale`), while that sales day isn't closed:
  the pack goes back in the back and the sale is removed.
- Game ended by mistake → Bring back (or it comes back by itself when received).

**Months** (one spreadsheet per month, like the owner's monthly Excel workbook)
- The owner starts each month on or after the 1st (never automatic): the amber **Start <Month> <Year>** button on the owner
  home (between the status card and Close Day, shown from the 1st until started, owner's request 2026-09-29) or on `month.html`.
- `startNewMonth` copies the current month's whole spreadsheet, so `CARRIED_FORWARD_TABS` (Users, Sessions, SlotConfig,
  SlotState, ReserveInventory) carry over exactly, then empties the log tabs except rows already dated in the new
  month (`MONTHLY_LOG_DATE_COLUMNS`). Those rows move out of the old spreadsheet, so starting late loses nothing.
- Safe to retry: an unregistered copy left by a failed attempt is trashed; the new month is marked active before the
  old one is archived (`getCurrentMonth` picks the latest active). A second tap is refused (`already_started`).
- `DailyCloseLog.previous_close_date` lets reopen/undo restore a pack's last close even when it was in an earlier month.

**Scanning**
- Press-and-hold is the default everywhere; Auto scan is an opt-in toggle (Close Day remembers it per phone).
- Every scan screen also accepts the typed printed number (`parsePrintedTicket`).
- The camera restarts itself (`keepCameraRunning` in scanner.js): iOS pauses the video while a confirm pop-up is open
  (e.g. Clear all scans, Sold out) or the app is in the background and never resumes it, which froze the picture (owner's
  bug 2026-09-29). Checked every second and on pause/focus/visibility/press: paused → `play()`, camera shut → reopened.
  It only acts while the video is on screen, so a page that hides it after `stopCamera()` (Close Day once closed) stays off.
- Scan feedback (`haptic()` in scanner.js; owner 2026-09-29): every saved scan buzzes + one short high beep; a scan that
  wasn't saved buzzes (Android: double) + two low beeps. The scanner reports each read as ok and the page may then report
  'error' for it, so reports are merged into one (played on the finger lift while held, else on a 0 ms timer). **iPhone** Safari has no
  `navigator.vibrate` and buzzes only when a *finger* flips an `<input type=checkbox switch>`: the app clicking one does
  nothing (owner's iPhone, iOS 18, tested 2026-09-29 in Safari and the home-screen app). So every Press and hold button is
  `<label class="button hold-button">`; `holdFeedback` → `prepareHoldButton` puts a hidden switch in it (text in a span — never set the
  label's textContent). The finger lifting flips it = the buzz. It must be enabled when the finger goes down: enabling it
  mid-hold, or a click handler on the label, killed the buzz (owner's Scanner test A–G, 2026-09-29). So a release with no
  scan disables it for that one click (re-enabled 100 ms later); no scan, no buzz. The beep's sound setting doesn't
  affect the buzz (tests H–J).
  Pages must not change the screen while Press and hold is down: Close Day redrawing mid-hold stopped the buzz (Back
  stock, which waits, buzzed). So scan results decide saved/refused (`haptic`) at once but draw via `afterLift(holdBtn, fn)`
  (scanner.js), just after the finger lifts (Close Day, slot page; Back stock has its own `whenHandsFree`).
  With no held button (Auto scan, typed number) an iPhone gets the beeps only (Web Audio, unlocked on the first press,
  `audioSession.type = 'playback'` so the silent switch doesn't mute it).
- Close Day's camera and Press and hold button never move between scans, and the progress bar, slot card with Sold out /
  Skip, camera and button all fit on an iPhone screen at once (owner 2026-09-29). So the scan message sits on the camera
  picture above the guide box (`.scan-flash`, text shrinks to fit), the current-slot card lines have fixed heights (the
  "Already done" line is one line, `fitText`), and the card stays ("All slots done") instead of hiding. A fixed-height
  message box *above* the camera was tried first: stable, but it pushed the button off screen (owner didn't want that).

## Code map

Frontend (`src/`, plain HTML + JS, no build):
- `config.js` backend URL and `STORE_NAME` (header eyebrow in nav.js, Theft Report) · `api.js` `api(action, params)`, session in localStorage, `requireLogin(role)`, `whileBusy`,
  and the unsent close (`getPendingClose`, `savePendingClose`, `sendPendingClose`, `canRetryClose`, `newCloseId`;
  one per phone in `smartScanPendingClose`)
- `barcode.js` `parseTicketBarcode`, `parsePrintedTicket`, `STANDARD_PACK_SIZES` · `scanner.js` shared camera
  (zxing-wasm, `startScanner({... mode})` → `{ setMode }`) · `style.css` shared styles
- **Look (owner's redesign 2026-09-28):** always dark; `style.css` tokens on `:root`; cards, chips, `.tile-card`, `.list-card`.
  `nav.js` fills `<header class="app-header" data-title=…>` (store name or a `data-back` link, title, name pill → More) and
  `<nav class="tabbar" data-active=…>`: owner Home · Scan (Close Day) · Stock · Reports (→ `reports.html`) · More; employee Home · Slots · More.
  The slot page (`activate.html`) has a back pill (`.back`: chevron + label, 44px tall, styled like the name pill and on
  one row with it, title underneath; owner 2026-09-30) instead of the tab bar; login/setup have no tab bar. Slots, Settling,
  Full pack sales and Shift Closure have a **Home** back pill → index.html (owner 2026-10-04; on Slots owner only, via
  `data-back-role="owner"`, since employees reach Slots from the tab bar). With a back pill the header is a grid: the name pill always stays top right on the
  same row, and a back pill text too long for the space left ("Shipments Received" next to a long username) shrinks to fit
  (`fitBackLabels` in nav.js) rather than pushing the name pill down (owner 2026-10-13). `icons.js` inline
  line icons (`icon(name)`, `data-icon`). Owner's rule: numbers are never cut off — put `fit` on the box and call
  `fitText`/`fitNumbers` (nav.js) after filling it; grids use `minmax(0, 1fr)`. Pages with the tab bar get
  `body.has-tabbar` bottom padding and `scroll-padding-bottom`, so scrolled-to buttons stop above the bar. Dialogs sit above it (z-index).
- **Saved answers** (`loadSaved(name, request, show)` in api.js): Slots, Settling (shares Slots' saved `listSlots`), Back stock,
  Months & totals, Reports, Shipments Received and Returned Packs (a `?date=` day view reuses its report's saved answer) draw the last answer saved on the phone at once, then the fresh one. While it shows, `body.showing-saved`
  dims `.saved-dim` and makes `.saved-lock` untappable (Back stock's list and ended games, Months' Start and past months), and
  Back stock's scans/search wait for the fresh list. A failed refresh keeps the saved answer (still locked) with the error.
- **Try again** (`showLoadError(el, err, load)` in api.js; owner 2026-10-04): when Slots, Back stock, Months & totals, Reports,
  Shipments Received or Returned Packs can't load, the reason shows at the top of the page (`#loadMessage`, under the header, seen without scrolling) with a Try
  again button that runs the page's loader again (it returns true once loaded, which clears the message). Back stock starts its camera only after it loads, so its Try again starts the camera too.
- **Launch screen** (`splash.js` + `.splash` styles; owner 2026-10-26): once per app open (sessionStorage `smartScanSplash`),
  on Home and Sign In, loaded first in `<body>`. SMART across in white and SCAN
  down in green sharing the S (white→green). Motion from the owner's own `smart-scan-splash.html` (2026-10-26), with the
  app's colors, sizes, words and Loading bar: a letter every 140 ms, S M A R T then C A N, each a 0.12 s fade, a blinking
  green underline cursor in the next letter's place; on beat 10 the corner barcode (made-up bars) slides open from the
  left (0.8 s) and a green beam sweeps back and forth inside it (1.3 s a pass). Tagline "Scratcher Inventory and Sales
  Tracking" and a Loading bar at the bottom. Closes once the animation has played (~2.7 s) **and** the page is ready: Home (`data-wait`)
  calls `splashReady()` when its first `loadStatus()` finishes; never past 8 s. Reduced motion: shown whole, ~0.6 s.
  Browser tests skip it (harness sets the flag) unless `openApp({ splash: true })`.
- **iPhone launch pictures** (owner 2026-10-26: a flash on opening the app): before the first page draws, iOS shows a
  blank screen or a saved picture of the app from an earlier open unless an `apple-touch-startup-image` fits the phone. `tools/startup-images.js` writes solid `--bg`
  PNGs per iPhone size into `src/icons/startup/` and prints the `<link>`s that sit in index.html and login.html; re-run
  it if `--bg` changes or a new iPhone size comes out. Manifest `background_color` is `--bg` too. iOS may only pick these
  up when the app is added to the home screen again.
  **Opening gray blink: iOS's, left as is (owner 2026-10-27).** Screen recordings read frame by frame (python3 cv2,
  frames in order) showed no Home/header before the launch screen. Only on the home-screen app (never in Safari), on
  every open, iOS zooms the black icon open in black and then shows its own gray (~#1A191A) until the page's first
  frame; a web page can't draw before that. Tried and reverted at the owner's request: a black launch (still blinked
  black → gray → black) and a launch in iOS's gray (owner didn't like it). Don't retry those. The native app (App Store
  plan, Phase C) fixes it with a real launch screen in --bg.
- **Home signed out, or after the 12-hour sign-in** (owner 2026-10-26: Home's empty page flashed before Sign In's launch
  screen): Home's `<head>` script sends it on to Sign In before anything draws. Safari keeps building and drawing a page
  after `location.replace` until the next one arrives (Chrome stops at once), so it also sets `html.leaving` (style.css
  hides the body; splash.js skips its turn, so Sign In gets it). The test holds the switch back with the Navigation API
  to play out Safari's way. Signed in, the home-screen app opens straight on Home.
- `index.html` home (also sends an unsent close, with a banner). Owner home = one `ownerHome` request; the last answer is saved
  per login in localStorage and shown at once, dimmed (`.stale`), until the fresh one arrives (a copy from an earlier day shows
  that day's close as the last close; only a fresh answer shows the Start month button). Owner: status card (Not Closed / Closed chip, big number = last
  close's $ — today's once closed, else this month's last closed day, else last month's; Tickets sold; Slots active), amber Start <Month>
  button (from the 1st until the month is started; confirm, then `startNewMonth`, then it hides), Close Day button, tiles Slots ($ on display = remaining × price), Back stock & shipments ($ in the back), Months & totals ($ sold this
  month), Settling (packs live 50+ days, amber when any), a full-width Full pack sales card (`.tile-wide`: packs sold this month
  and their $, from `ownerHome.fullPacks`; opens `full-packs.html`), a full-width Shift Closure card (shift closes this month and
  the latest "3:02 PM · Today by sara", from `ownerHome.shifts`; opens `shifts.html`), a quieter **Close My Shift** button
  (`.action-shift`) under Close Day, Manage employees row (Scanner test is in More only, owner 2026-09-29). A big red round
  **Theft Report** button (`#theftFab`, `.theft-fab`: red `--danger-solid` circle, black `theft` icon — owner's red and black) floats at the bottom right above the tab bar
  on Home only (owner 2026-10-23; not on other pages so it never covers Close Day's camera/hold button), for the owner and
  employees with `theft_report` (`showTheftButton`); `body.has-fab` adds bottom room so it never hides the last row. Employee: status card (Ready to scan / Day closed + submitted by) and a big
  Scan Tickets button → Close Day, and under it Close My Shift (hidden once the day is closed; a greyed "Shift Closed at
  2:00 PM" once they've closed one today, from `closeStatus.myShiftToday`), then an "Also allowed" section with a link per
  permission the owner turned on (Load / Return Packs → Slots; Ticket Order → More; Receive a Shipment, Manage Stock, Sell a Full Pack →
  `backstock.html?mode=…`; Theft Report → `theft-report.html`); no dollars. · `more.html` Manage employees (owner), **Retailer Number** (owner only: a pop-up that asks for the number only when
  opened, Cancel / Save; `getRetailerNumber` / `setRetailerNumber`; icon `store`), Ticket order (owner / `ticket_order`: pop-up All descending / All ascending, Cancel / Save), Scanner test, Change my password, Sign out ·
  `login.html` (Email + Forgot Password? on the database) · `set-password.html` (database: invite / password email links) ·
  `setup-owner.html` · `account.html` · `users.html` (owner; on the database an employee is added by username + email; each employee card has a switch per permission,
  `.perm-row` + `input.toggle` in style.css, saved at once with `setUserPermissions`, plus Turn All On/Off; folded under a
  "Permissions · N of 7 on" row, `details.perm-details`, closed at first and kept open across saves — owner 2026-10-08)
- `settling.html` (owner, 2026-09-29) live packs at `OLD_PACK_DAYS` (50) or more, longest first (`settlingPacks` in api.js,
  from `listSlots`, so a sold-out/returned pack drops off by itself): Box · Slot, game · pack, days (amber 50–59, red from
  `SETTLED_PACK_DAYS` 60 = most likely settled), ticket price, tickets left and value as of the last close; tap → slot page (`&from=settling`, so its back pill and
  "Back to settling" return to Settling; opened from Slots they return to Slots, owner 2026-09-30).
  Icon `settle` (handshake under a $ coin) in icons.js.
- `full-packs.html` (owner, 2026-09-30) this month's full pack sales (`listFullPackSales`, saved answer first): green
  **Sell a Full Pack** → `backstock.html?mode=fullpack`, totals (packs, $), one card per sale newest first (day, game ·
  pack, ticket price, pack size, total value) with Undo until that day is closed. Icon `ticket`.
- `shifts.html` (owner, 2026-09-30) Shift Closure: this month's shift closes by day, newest first (`listShiftCloses`, saved
  answer first): who · when, $ chip, from → to, tickets / $ / slots scanned, packs ended or sold whole during it, Slots
  (every slot's start → end ticket) and Delete (confirm). Icon `shift` (two block arrows, from the owner's picture).
- `slots.html` both boxes (everyone sees the ↓/↑ ticket order arrow, `.order-arrow`; owner also sees days since activation and the day-50 mark) · `activate.html?box=&slot=` one slot: end pack (Sold out / Returned show "N sold today ($X)[, M going back]" before anything saves, and a red Cancel on every step after them returns to "What Happened to It?" unsaved), activate, undo; then (owner's order) slot price, Ticket Order (`#orderForm`: Descending / Ascending, the chosen one in the app's green, `#orderSwitch button.active`; greyed while a pack is in), pack size, move or swap
- `close.html` Close Day: walks live slots box 1 → 2, slot 1 → 24; a scan finds its slot by game+pack; Sold out /
  Skip (no "No sales" button — every live slot must be scanned; unchanged ticket = 0 sold). Scans are a draft in
  localStorage until submitted; anyone can **Clear all scans** (this phone's draft only, e.g. after a practice
  close). Views: scanning, closed (summary, with "Submitted at 10:52 PM by <username>" from
  `DailySummary.closed_by`/`closed_at`, server time when saved; closes before 2026-09-27 have no line), and pending ("saved, not sent yet": Try sending now / Stop sending).
- `month.html` (owner) Months & totals: this month's totals + per-day table, Start New Month, past months' totals; ‹ Reports pill.
  With the database backend (a month's `url` null, `status.next` null) there's no Start box or "You can start" line, and each
  month has **Download Month** (`downloadMonth`): `monthWorkbook` → an .xlsx made in the browser with SheetJS
  (`xlsx@0.18.5` from jsdelivr, loaded only on tap): Summary, one tab per day (every line: box, slot, game, pack, price,
  start/end ticket, sold, $, type, by), Shipments, Back Stock Out; $ cells formatted. Shared as a file (iPhone share sheet:
  Save to Files, Mail), else downloaded. Test: test/browser/month-download.js.
- **Reports tab** (owner 2026-10-13): `reports.html` lists three reports plus the Theft Report (below), each row with this month's numbers from one
  `reportsPage` request (saved answer first, Try again): **Months & Totals** (`month.html`, $ sold), **Shipments Received**
  (`shipments.html`, packs · $, icon `truck`), **Returned Packs** (`returns.html`, packs · $, icon `returned`). Each report
  has a **‹ Reports** pill back to the list (Months & Totals too, even when opened from its home tile); the list itself
  has none (it's a tab). No home cards for the two new reports (owner's choice); home is unchanged.
  - Both reports (owner 2026-10-13, later): the list is **one card per day** (day, $ chip, "N Games · N Packs", ›); tapping it
    opens `?date=yyyy-MM-dd` on the same page: that day's lines numbered 1 to N in a table (`.report-table`) with a Total row.
    The day view's back pill goes to the report's list (set by an inline script before nav.js), whose pill goes to Reports.
  - `shipments.html`: this month's Shipments rows (`listShipments`), one line per game per day (several scan-ins that day
    added up; **Added by Hand** = Manage packs +, source "add pack", kept as its own line, noted under the game number).
    Table: #, Game, Packs, Ticket Price, Pack Size, Total Value (tickets × price, so the month total = Months "Shipments in").
  - `returns.html`: this month's returns to the lottery (`listReturns`): **From Slot** = a pack ended as Returned on the slot
    page (PackHistory `end_reason 'returned'`; one card per pack: game · pack, box · slot, Tickets Returned = remaining_at_return,
    price, value; an undone return has no row so it drops off), **From the Back** = sealed packs removed from back stock with
    reason "returned" (ReserveAdjustments; same game same day combined; price from ReserveInventory). Other removal
    reasons (game expired, damaged, stolen, other, count, adjust) are not returns. Totals: packs (slot returns count 1 each), $.
    Table: #, Game (with "Pack … · Box 1 Slot 5" or "From the Back" under it), Returned ("21 tickets" / "2 packs"), Ticket
    Price, Pack Size (a slot return's from ReserveInventory), Total Value.
  - **Theft Report** (owner 2026-10-23): last row on Reports (muted words "Packs and Tickets to Stop", no number, icon `theft`)
    → `theft-report.html`; also an employee's Also Allowed link with `theft_report` (their back pill is Home, set by an inline
    script before nav.js; the owner's is ‹ Reports). Pick **Live Scratchers** (slots only) or **Full Inventory** (slots + back
    stock) with radio cards (`.radio-card`), then **Make Report** → one `theftReport({ full })` request, always fresh (no saved
    answer; changing the choice hides the old report; errors use `showLoadError`). Shows store (`STORE_NAME`, config.js),
    made at (server time), **Retailer Number** under the store name (also first lines of the shared text and the PDF;
    `theftReport.retailerNumber`; shown in full to everyone who can make the report, employees with theft_report too —
    owner's choice 2026-10-26; not entered: the owner sees "Not Set (Add It on More)", an employee no line), "Last Close: <day>, <time> by <user>" (`lastKnownClose`: newest DailySummary row, else last
    month's), "Last Shift Close: Today, <time> by <user>" (only while today isn't closed), totals, a table per live pack
    (game, pack number, box · slot · where its count is from, unsold range `000–024` descending / `010–049` ascending, left,
    value). **Each pack's range starts at its newest count** (owner 2026-10-23, for a theft after a mid-day shift close):
    `source` 'shift' = today's latest shift close that counted it (`shiftStarts`; ignored once today is closed, since shift
    closes come before the close), 'activation' = put in since the close (blank `last_close_date`: its activation ticket),
    'close' = the last Close Day (SlotState). A pack marked sold out at a shift close (still in its slot) shows "Sold Out at
    Shift Close 3:02 PM by sara" (`soldOutAt` = the shift close it first sold out at), no range, 0 left, not counted in the
    packs total. **Only this report uses shift closes**; Slots, Close Day and Settling still ignore them. And for
    Full Inventory a Back Stock table per game (packs, tickets, value) — **back stock has no pack numbers** (only game
    counts in ReserveInventory; owner chose 2026-10-23 to add per-pack back stock with the database move, not on Sheets).
    **Share** = `navigator.share` text (clipboard copy where there's none). **Print / Save PDF** builds a PDF of the report
    (`reportPdf` → `SimplePdf` in `pdf.js`: no library, Helvetica, US Letter, head row repeated on each page, "Page N of M") and
    shares the file (`navigator.share({ files })`: the share sheet has Print, Save to Files, Mail) — the iPhone **home-screen app
    ignores `window.print()`** (owner 2026-10-23: Share worked, Print didn't). Only where files can't be shared (a computer)
    it falls back to `window.print()` with `@media print` (white, only the report; `.no-print` hides the choice and buttons). Employees: no Value column, no $ (server
    strips them, `theftReportWithoutDollars`). Nothing is saved or written.
- `backstock.html` (owner; an employee with Receive shipments / Manage Stock / Full pack sale gets only those modes — no
  search, no list, no $; `?mode=shipment|count|fullpack` opens that mode) **Find a Game** search at the top (by game number as you type; packs in the back and the
  slots it's on display in, from `listBackStock().liveIn`; its buttons report right under it). **Shipment Received**: a scanned/typed game opens a
  pop-up (owner 2026-09-28): "Packs Received" − count + starting at 1 (− stops at 0, Save greyed there), a new game also
  asks price + pack size; Save sends `saveBackStock` shipment for that one game at once (source "delivery", no notes).
  A scan opens it only after the finger leaves "Press and hold" (`whenHandsFree`): opened under the finger, iPhones
  swallowed the first tap on +.
  **Manage Stock** (count mode, renamed from "Count the back" 2026-10-02; sets) still uses the list: scan one ticket per game, enter packs, Save count; one **Manage packs** dialog on every game (owner
  2026-09-27: replaced Add pack + Remove packs): − count + with red Cancel / green Save. Save with more packs sends
  them as a shipment; with fewer it shows "Remove N packs (a → b). Why?" with reason buttons (returned, game expired,
  damaged, stolen, other), red Cancel and Back, and nothing changes until a reason is tapped; Game ended / Ended games list.
  **Full pack sale** (3rd mode; `?mode=fullpack` opens it): a scanned/typed *full* ticket number (a bare game number is
  refused) opens "Sell Full Pack" (game · pack, value, "$20 × 30 tickets", "Back: 2 → 1", red Cancel / green Sell) after
  the finger lifts; a game with none in the back is refused before the pop-up. Switching to it never changes the saved
  shipment/count draft, and it hides that list.
- `manifest.webmanifest`, `icons/`, `sw.js` home-screen app. **Cache-first** (database plan Phase 0, owner approved
  2026-10-14, built 2026-10-23): every page and script opens from the phone's saved set at once, never waiting on the
  network. Each `CACHE` value is one complete set of `SHELL`, downloaded together (`?v=<CACHE>` past GitHub's CDN,
  `cache: 'reload'` past the phone's) when the phone sees a new sw.js — checked on every page open, and by `api.js`
  (`registration.update()`) when the app comes back to the front. All or nothing: a failed file keeps the old set. The new
  set is used **from the next page opened** after it downloads, so a page and its api.js always come from one deploy.
  The pinned zxing CDN files are kept after their first download. Registered in `api.js`.
  **Bump `CACHE` in `sw.js` on every deploy that changes a saved file, then run `node test/sw-version.js --update`**:
  without a bump the phone keeps the old files forever. `test/sw-version.js` fails until both are done, and fails if a page
  or script in `src/` is missing from `SHELL` (dev/one-time pages listed in `NOT_SAVED`).
  The backend must keep answering the previous pages for a while: a phone runs the old pages until its next page open.
  The installed app has its own storage on iOS (sign in again there).
- `raw-scanner.html` Scanner test (dev) plus the iPhone vibration/sound test buttons 5–8 and A–K (K = the real
  `holdFeedback` code); owner wants them kept for now · `backend-test.html` dev page

Backend (`src/apps-script/`, pushed with clasp; all files share one global scope):
- `WebApp.js` `doPost` router: `PUBLIC_ACTIONS`, `SIGNED_IN_ACTIONS` (`owner: true` = owner only); `doGet` health check
- `Schema.js` tabs/headers, `CARRIED_FORWARD_TABS`, `STANDARD_PACK_SIZES`, `INITIAL_SLOT_PRICES`
- `Sheets.js` `readTable`, `appendObject`, `updateRowsWhere`, `deleteRowsWhere`, `ensureHeaders`, `withLock`, `setCell`
- `Months.js` active month lookup (Control → Months tab), `monthStatus`, `startNewMonth`, `listMonths`, `monthSummary`,
  `monthsPage` (Months & totals in one request: status + this month's summary + every month)
  · month spreadsheets live in Drive folder "Smart Scan Monthly Sheets": one-time `moveMonthsToFolder()` (run in the
  editor) moves them and saves its id (script property `MONTHS_FOLDER_ID`); `monthsFolder()` = where Start New Month
  copies to, falling back to Control's folder. Months are opened by id, so moving files never affects the app.
  (totals from that month's DailySummary) · `Setup.js` one-time `setup()` (safe to re-run; adds missing columns).
  `getCurrentMonth`/`openCurrentMonth` keep the month and its opened spreadsheet for the rest of a request (reset in `doPost`).
- `Home.js` `ownerHome`: everything on the owner's home in one request (closeStatus + monthStatus + this month's $ + last
  close + back stock $ + this month's full packs).
- `Shifts.js` (`shiftStarts` also gives `closedBy`, and keeps the shift close a pack first sold out at) `shiftStatus`, `submitShiftClose(user, entries, shiftId, date)`, `listShiftCloses`, `deleteShiftClose`,
  `shiftHomeSummary` (for `ownerHome.shifts`), `shiftStarts`, `endedInShift`, `nowStamp` (also used for `logged_at`).
  `closeStatus` also returns `myShiftToday` (an employee's own shift close today).
- `Reports.js` (read only) `listShipments`, `listReturns`, `reportTotals`, `reportsPage` (the Reports list's numbers: this
  month's DailySummary $ + both reports' totals), `theftReport(user, { full })`, `lastKnownClose`, `lastCloseBeforeThisMonth`.
- `FullPacks.js` `sellFullPack`, `undoFullPackSale`, `listFullPackSales`, `fullPackTotals` (also used by `monthSummary`). Each Web App request costs ~2 s however small, so a page should ask once, not once per number.
- `Auth.js` / `Users.js` logins, sessions, owner setup code, employee management (`setUserPermissions`)
- `Store.js` the store's **retailer number** (owner 2026-10-26; see Theft Report): `retailerNumber()`, `getRetailerNumber`,
  `setRetailerNumber` (owner only, digits 4–12, spaces/dashes dropped). Kept in Script Properties `RETAILER_NUMBER` only —
  **never in a sheet, the code, tests, git or notes** (the repo is public). Tests use made-up numbers.
- `Permissions.js` `PERMISSIONS`, `permissionsOf`, `can`, `requirePermission` (employee permissions; loaded by the tests)
- `Tickets.js` ticket order math (see "Ticket order per slot" above)
- `Slots.js` `listSlots` (`slotOrder`, `pack.order`), `setSlotOrder`, `setAllSlotsOrder`, `activatePack`, `endPack`/`endPackInSlot`, `undoActivation`, `undoEndPack`,
  `swapSlots`, `setSlotPrice`, `setPackSize`, `setActivationDate`, `addGameToReserve`, `dateLabel`
- `Close.js` `closeStatus`, `submitClose(user, entries, closeId, date)` (validates everything before writing),
  `buildSummary`, `reopenClose`, `salesDate`
- `Backstock.js` `listBackStock` (every game, ended ones flagged `endedDate`), `saveBackStock(mode 'shipment'|'count')`,
  `adjustBackStock` (Add pack: `change` packs; more → Shipments row, source "add pack"; fewer → ReserveAdjustments, reason
  "adjust"), `removeBackStock`, `endGame`, `bringBackGame`

**Back pills (owner's rule 2026-10-13):** the name pill always stays at the top right, on the same row as a back pill, on
every page. Never let a back pill push it down or sideways. Add a back pill only through the header
(`data-back` / `data-back-label`, or set those in an inline script before nav.js, like the report `?date=` views), never
by hand-made markup, so it gets the grid layout and `fitBackLabels` (long text shrinks to fit). Keep labels short (the
page they go back to). `test/browser/home-pill.js` finds every page with `data-back=` by itself and checks short and
long usernames; a page whose pill changes with the address (like `?date=` or `&from=`) needs that address added there.

**Third-party tool (owner's rule 2026-10-26; App Store + Google Play plan `~/.claude/plans/smart-scan-app-store-launch.md`):**
Smart Scan is an independent bookkeeping tool, **not** a lottery app. It never claims or suggests a lottery approved,
endorsed or partnered with it. **No scratcher (game) names, no lottery logos or trademarks, no pictures of tickets**
anywhere: screens, icons, store listings, screenshots, website, emails, test data. Games show by number only. Screens say
"the lottery", never "CA Lottery" (`test/browser/disclaimer.js` fails on "CA Lottery" in any `src/` page or script). Never add
a game catalog, ticket art, prize tables, odds or "prizes remaining". The disclaimer is `APP_DISCLAIMER` (api.js), shown in
small print on Sign In (`.fine-print`) and in More → **About Smart Scan** (everyone, a pop-up with Close, icon `info`);
`REPORT_FOOTER` ends the Theft Report on screen, in the shared text and on every PDF page.

**Wording (owner's rule 2026-10-08): Title Case** for page titles, section titles, pop-up titles, permission names,
buttons and links, tabs, form labels, stat/tile labels and tags/chips ("Sell a Full Pack", "Shipment Received",
"Price per Ticket ($)", "25 Left", "Out of Stock", "Not Closed"). Small words (a, an, the, and, or, of, to, in, on, at,
for, by, per, from, with) stay lowercase unless first. Sentences stay sentence case: explanations (`p.sub`), detail
lines, messages, confirm() questions, scan flashes. Usernames stay as typed. Scanner test's A–K diagnostic labels are
left as they are. New screens follow the same rule.

Conventions: every write runs inside `withLock`; validate the whole request before writing anything;
errors are `ApiError(code, message)` with a message the person at the counter can act on.
New columns go at the **end** of a tab. Existing month sheets don't have them yet: call `ensureHeaders` before
writing one, and read them defensively (a missing column reads as `undefined`, and `dateLabel(undefined)` is the
string "undefined", so check the value first). `SlotState.remaining_count` is a formula column that must not move.
Recent columns: `SlotConfig`/`SlotState`/`PackHistory.ticket_order`, `Users.permissions`, `DailyCloseLog.logged_at`, `DailySummary.close_id`, `DailySummary.closed_by`/`closed_at`, `ReserveInventory.ended_date`, `DailyCloseLog.previous_close_date`,
`SlotState.last_game_number`.

## Supabase (database move, in progress — the app still runs on Sheets until the Dec 1, 2026 cutover)

Plan: `~/.claude/plans/submitting-reports-and-updating-mossy-floyd.md`. Account: the owner's own **iyadshaheen90@gmail.com**
(the product is theirs; Route 66 Liquor is its first store). Dev project **`smart-scan-dev`** (ref `kqoenvgcbypnehmjefjx`,
West US, Free) — test data only; prod (Pro) is made near cutover. No local Supabase (this Mac can't run Docker): tests run on
the dev project. The CLI is `npx --yes supabase@2.122.0` (signed in via the owner's keychain; folder linked to dev).
- `supabase/migrations/*.sql` — the schema, applied with `npx --yes supabase@2.122.0 db push --linked --yes`. Never edit an
  applied migration; add a new one.
- **Store separation:** tables in schema `app` (not exposed; anon/authenticated have no access at all). Pages will call
  functions in `public` (`supabase.rpc`), `security definer` **owned by role `smart_scan_api`** (NOBYPASSRLS — `postgres`
  bypasses RLS, so never leave a function owned by postgres). Each starts with `app.enter_store(store, allowed)`: checks
  the caller (`app.uid()` = JWT sub) is an active member, owner-only (`'{owner}'`) or one of the permissions, then sets
  `app.store_id` for the transaction. Every table has **forced RLS** `store_id = app.current_store_id()`, so even a query with
  no `where store_id` sees only that store. Errors: `app.fail(code, message)` → the hint is the app's error code.
  New functions: `alter function … owner to smart_scan_api` (the migration grants `create` on the schemas while it runs),
  `revoke execute … from public, anon`, `grant execute … to authenticated`.
- One row per pack (`app.packs`, status in_back / live / sold_out / returned / full_pack_sale / removed), so back stock
  has pack numbers; `games.unnumbered_in_back` holds packs from the sheets until the one-time "scan the back".
- `performed_by` / `closed_by` are usernames (as in the sheets), `store_members.username`.
- **API shape:** every action is `public.<snake_case>(p_store uuid, req jsonb) returns jsonb`, the same request fields and
  answer JSON as the Apps Script action (`listSlots` → `list_slots`), so only `api.js` changes. Checks, their order and
  messages copy the Sheets code; `app.js_num` / `app.js_text` mimic JavaScript's Number() and `${…}` on request fields.
  Writes take `app.lock_store()` (withLock). The store clock: `app.today()`, `app.local_now()`, `app.now_tz()` (a test
  store's `test_now`). Don't name a plpgsql variable like a column (price, close_id): it's ambiguous inside UPDATE/WHERE.
  Supabase refuses DELETE/UPDATE without WHERE (pg_safeupdate): add `where store_id = app.current_store_id()`.
- Ported so far (parity-checked, `test/parity/*.js`): listSlots, closeStatus, activatePack, endPack, undoActivation, undoEndPack,
  swapSlots, setSlotPrice, setPackSize, setSlotOrder, setAllSlotsOrder, submitClose, reopenClose; listBackStock, saveBackStock,
  removeBackStock, adjustBackStock, endGame, bringBackGame, sellFullPack, undoFullPackSale, listFullPackSales; shiftStatus,
  submitShiftClose, listShiftCloses, deleteShiftClose; listShipments, listReturns, reportsPage, theftReport; ownerHome, monthStatus,
  monthSummary, listMonths, monthsPage (no spreadsheets: `url`/`currentUrl` null, no month to start: `next` null, `canStart`
  false), plus the database-only `monthWorkbook` (a month's data for the Excel download); listUsers, setUserActive,
  setUserPermissions (`test/parity/users.js`; listUsers adds `email` and `signedIn`); getRetailerNumber, setRetailerNumber
  and theftReport's `retailerNumber` (`test/parity/retailer.js`); setActivationDate (migration 0015,
  `test/parity/activation-date.js`); missed days + Close Yesterday (migration 0016: `build_summary` window,
  `covered_by_close`, `changed_today`, `close_yesterday_json`, `submit_close` late, `reopen_close` date, `end_pack_in_slot`
  on_date, `summary_json` closedLate; `test/parity/missed-day.js`). Known difference: the database also offers it on the 1st
  after a month start (no spreadsheets). The retailer number is **encrypted in Supabase Vault**
  (one secret per store, `retailer_number:<store id>`, migration 0014), never in a table. Vault is readable only by postgres,
  so `app.store_retailer_number()` / `app.save_retailer_number()` / `app.forget_retailer_number()` are the one exception
  owned by postgres: they touch only the entered store's secret and only smart_scan_api may call them. `public.theft_report`
  now wraps `app.theft_report_body` (the 0010 report) and adds the number.
  Counted back stock (shipments, counts, removals, Manage packs) works on `games.unnumbered_in_back` first, then numbered packs.
- **Parity tests** (`test/parity/*.js`, harness `test/parity/harness.js`): the same steps on the real Apps Script code (fake
  sheets = the answer key, run through `SIGNED_IN_ACTIONS` like doPost) and on a throwaway test store in smart-scan-dev
  (made with the service key via `public.test_*` functions, which refuse any store that isn't `is_test`; real auth users
  o / e / loader / sara, deleted afterwards). Every answer and error must be identical. `p.seed({ slots, games, packs,
  closes })` gives both sides the same rows; `p.setClock(day, time)`.
  Known differences on purpose: one transaction per call (an error changes nothing); back stock by pack number; a pack
  ended in an earlier month can't be activated again; months have no spreadsheet or month to start (`months-home.js`
  drops url/currentUrl/next/canStart before comparing). The harness runs Months.js/Home.js against a one-month Control fake.
- Tests: `node test/db/run.js` runs `supabase/tests/*_test.sql` on the dev project, each in a transaction it rolls back
  (asserts in DO blocks; switch users with `set local role authenticated` + `set local request.jwt.claims`).
  `npx --yes supabase@2.122.0 db advisors --linked` should show only the two expected warnings (definer API functions callable
  by signed-in users; two select policies on stores/store_members).
- **Owner's rule (2026-10-23): every feature added during the move goes into the Supabase version too.** Pages and buttons
  carry over unchanged; a new or changed backend action, field, permission or rule must be ported (with a parity test) or
  added to the migration plan's "Added during the move" checklist — and say so in the summary to the owner.
- **Sign-in and the `api.js` seam (built 2026-10-26):** `config.js` `BACKEND` ('sheets' until cutover; 'supabase' then,
  back to 'sheets' = rollback), `SUPABASE_URL` / `SUPABASE_ANON_KEY` (empty until cutover, filled with the **prod**
  project's). With 'supabase', `api(action)` → `dbApi`: `public.<snake_case>` with `{ p_store, req }`, the hint → `ApiError`
  code; `DB_ACTIONS` covers what isn't a database function: login (email + password → `my_stores` → session with
  `storeId`, the first store by name — a store chooser is Phase 5), logout (this phone only), forgotPassword, setNewPassword,
  changePassword (checks the current one by signing in, keeps the new sign-in's tokens since a new password ends the
  others), createUser / resetPassword (→ the **members Edge Function**), me, claimOwner (refused). The session keeps the
  access token (1 h) and refresh token; `freshToken` renews a minute early (one renewal at a time), a 401 is retried once,
  `unauthorized` → Sign In. Signed in 12 h, as on Sheets (`DB_SESSION_HOURS`).
  `login.html` asks for Email and shows **Forgot Password?** (no owner setup link). `set-password.html` (new) is where invite
  and password emails land: the one-time sign-in in the `#` is taken out of the address, they choose a password and are
  signed in (a note says to sign in again in the home-screen app: iOS keeps its own storage). `users.html` adds an employee
  by **username + email** (no starting password; "Employee · Invited" until they first sign in, `store_members.signed_in_at`
  set by `my_stores`), shows each email; Reset Password = the owner sets one (also confirms the account, so it works without
  the invite email). Migration 0012: `store_members.email/signed_in_at/seq`, a turned-off account → `unauthorized` "This
  account is no longer active." on its next request, `member_admin_check` (the owner's checks before the function touches
  any account), `service_add_member` (service key only).
  `supabase/functions/members/index.ts` (Deno, plain fetch): `invite` (Supabase Auth invite email; a **test store gets
  `testLink` back** instead, via generate_link; an email with an account already → refused; account deleted again if adding
  the member fails) and `setPassword`. Deploy: `npx --yes supabase@2.122.0 functions deploy members --use-api` (no Docker).
  Auth settings live in `supabase/config.toml` `[auth]` and go up with `npx --yes supabase@2.122.0 config push` (answer only
  the auth prompt; it shows the diff first): site_url = the GitHub Pages `src/`, redirect list (Pages + `http://localhost:*`
  for tests), **public sign-up off**. Known difference: the owner setting a password doesn't sign that person out (Sheets
  ended their sessions); turning them off does, on their next request.
  **Emails (owner 2026-10-29): the store's Gmail for now, our own domain later** (needed for the App Store anyway; switching
  is a config change, no code). config.toml `[auth.email.smtp]` = smtp.gmail.com:587, `user`/`admin_email` =
  `env(SMTP_USER)`, `pass` = `env(SMTP_PASS)` (a Gmail **app password**; needs 2-Step Verification on that Gmail), sender
  name "Smart Scan". Both live only in `~/.smart-scan/smtp.env` (mode 600, never in the repo). **Push auth settings only
  with `sh scripts/push-auth-config.sh`**: it loads that file and refuses if it's empty — a plain `config push` would save
  the literal "env(SMTP_PASS)" and stop every email. Templates in the store's words: `supabase/templates/invite.html`
  ("Your Smart Scan Account", button Choose My Password) and `recovery.html` ("Reset Your Smart Scan Password"); no lottery
  names/logos, the independent-tool line at the bottom. Links work 24 h (`otp_expiry = 86400`, Supabase's max) and once;
  `email_sent = 30` an hour (the cutover invites everyone at once).
  **New passwords at cutover (owner 2026-10-29: both):** Sheets passwords can't move (different hash), so everyone gets
  an invite email at the prod import, and the owner uses Reset Password for anyone who has trouble. **Resend Invite**
  (Manage Employees, database only: shown on an active "Invited" card) → members function `resendInvite` → a new invite;
  the old link stops working. Refused for someone who has signed in, is turned off, or whose password the owner set
  (that confirms the account: "… already has a password (you set one)…"). Migration 0019 (`member_admin_check`
  'resendInvite'); tested in db-sign-in.js. Sheets has no emails, so nothing there.
  Still before cutover: the prod project. (Users + emails: given 2026-10-27, in `~/.smart-scan/members.json`.) After the
  switch the owner enters the retailer number again on More (the Sheets copy is in Script Properties; the import can't read it).
- **Password rule (owner 2026-10-27), on both backends (live on Sheets: backend @40, sw v44; database: dev only so far):** a new password needs at least 8 characters, a capital letter,
  a lowercase letter, a number and one of `? ! @ # $ % &` (other signs allowed but don't count). Written three times with
  the same words — `passwordProblem` / `checkNewPassword` / `PASSWORD_RULE` in api.js, `validateNewPassword` in Auth.js
  (claimOwner, createUser, resetPassword, changePassword), `passwordProblem` in the members Edge Function — and
  `test/password-rule.js` makes sure all three agree. Pages show PASSWORD_RULE under each new password field
  (`.password-rule`: account, set-password, setup-owner, users) and check before sending; the message names only what's
  missing ("Password needs a capital letter and a number."). Supabase auth: `minimum_password_length = 8`,
  `password_requirements = "lower_upper_letters_digits_symbols"` (config.toml; pushed to dev). Existing passwords
  still sign in; only new ones are checked. Test sign-ins (parity harness, import-compare, db-sign-in) end in `Aa1!`.
  **Not the same password again (owner 2026-10-27):** a new password can't be the one it replaces —
  `SAME_PASSWORD_MESSAGE` "The new password can't be the same as the last one." (same words in all three copies).
  Sheets: resetPassword and changeOwnPassword compare against the stored hash. Pages: Change My Password checks new ≠
  current before sending. Database: Change My Password and Forgot Password get Supabase Auth's `same_password`
  (api.js turns it into the message; set-password.html no longer treats it as saved); the owner's Reset Password goes
  through the admin API, which doesn't check, so the members function asks `public.service_is_current_password`
  (migration 0018, postgres-owned, service key only, bcrypt compare, yes/no). Only the last password, not a history.
- **The import (built 2026-10-27; real Sep + Oct exported and checked 2026-10-27 10:22: no problems, 1221 close lines, 67 packs, 25 reads identical; totals matched the owner's phone):** Sheets `exportMonth`
  (`Export.js`, owner only, read only, no page calls it): no label → the month list; a label → every tab as plain rows,
  dates as store-time text, no Sessions or password columns. `scripts/import-sheets.js export` signs in as the owner
  (password typed, hidden; run it in Terminal, not with `!`), saves each month to `~/.smart-scan/export/` (outside the
  repo); `check` maps them with `scripts/import-map.js` (pure; anything the database can't take is listed and stops it:
  a pack ended twice, a close line for an unknown pack, a user without an email, a log row in the wrong month…) and runs
  `scripts/import-compare.js`: a dev test store, made-up sign-ins for the same people, `service_import_store`, and every
  read the pages use against the Sheets code over the exported months (vm) at the export's moment. Emails:
  `~/.smart-scan/members.json` (owner gave them 2026-10-27; never in the repo). Migration 0017: `service_create_store`
  (the real store at cutover) and `service_import_store` (service key only, one transaction, empty store only, rows in
  the sheets' order so id order matches row order). Packs: live from the newest SlotState, ended from every month's
  PackHistory; activation ticket = the first close line's previous ticket; ended_at = the ending close line's logged_at.
  Prod import (real emails, invites) still to build at cutover.
- **Next (owner's decisions pending):** prod project (Supabase Pro $25/month — owner's OK before creating it; its auth
  settings from config.toml, incl. the password rule), Gmail SMTP on it (owner's app password in smtp.env), the prod
  import (real emails from `~/.smart-scan/members.json`; sends everyone an invite, owner's choice 2026-10-29),
  a full side-by-side run with `BACKEND = 'supabase'`, then the final Nov export + import after the Nov 30 close. Later: per-pack shipment scan-in (numbered back stock) and the Theft Report listing those packs.
- **After the cutover: App Store + Google Play launch** (plan `~/.claude/plans/smart-scan-app-store-launch.md`; Phase A, the
  third-party wording, is done). Owner's choices: billing both (in-app via RevenueCat + Stripe web checkout), an LLC as the
  seller, California first then more states, keep the name Smart Scan. Still open: price and trial; whether Route 66 Liquor
  stays on the web app. Needs self sign-up + setup wizard, subscriptions, in-app account deletion, privacy/terms pages, a
  demo store, Capacitor apps with cloud builds (this Mac can't run Xcode 26).

## Data (one spreadsheet per month, "Smart Scan — YYYY-MM", in Drive folder "Smart Scan Monthly Sheets")

Users, Sessions, SlotConfig, SlotState, ReserveInventory, Shipments, ReserveAdjustments, DailyCloseLog,
DailySummary, PackHistory, ShiftCloses, ShiftCloseLog (the last two from Oct 2026; added on first use before that). Columns are in `Schema.js`. The owner reads these after each close but should not
hand-edit them.

## Test and deploy

```sh
node --test src/*.test.js                 # barcode parsing
node test/backend-scenarios.js            # backend against a fake spreadsheet (store scenarios)
node test/ticket-order-scenarios.js       # ascending/descending per slot: counts, refusals, shifts, returns, undo, swap, Set all
node test/theft-report-scenarios.js       # Theft Report backend: ranges (desc/asc/put in since close/after shift closes, sold out at a shift close, today closed), back stock, no $ for employees, last close
node test/reports-scenarios.js            # Reports tab backend: shipments/returns lines (combined, tags, left out), totals = Months "Shipments in"
node test/new-month-scenarios.js          # Start New Month against fake Drive/Sheets (fakes in test/fakes.js), incl. moveMonthsToFolder + folder fallback
node test/export-scenarios.js             # exportMonth: month list, tabs as rows, dates as text, no Sessions/passwords, owner only
node test/password-rule.js                # the password rule: api.js, Auth.js and the members Edge Function give the same answer for every sample; Sheets refuses the same password again

npm install                               # once: puppeteer-core, only for the browser tests (needs Google Chrome)
node test/browser/offline-close.js        # Close Day with no connection, lost answer, home resend, refusal
node test/browser/backstock-search.js     # Find a game
node test/browser/backstock-remove.js     # Manage packs, removing: why step, Back, Cancel, reasons, refusal (real backend code, fake sheet)
node test/browser/backstock-add-pack.js   # Manage packs, adding: + / −, Cancel, Save as shipment (real backend code, fake sheet)
node test/browser/backstock-shipment.js   # Shipment received pop-up: starts at 1, 0 greys Save, new game, ended game, waits for scan release
node test/browser/backstock-game-ended.js # Game ended / Bring back (real backend code, fake sheet)
node test/browser/slots-days.js           # Slots: days since activation + day-50 mark (owner), none for employees
node test/browser/home.js                 # home for both roles: one request, saved numbers first, tiles, chips, Start month, huge numbers fit
node test/browser/saved-pages.js          # Slots, Settling, Back stock, Months: saved answer first (dimmed, locked), then fresh
node test/browser/close-layout.js         # Close Day: button stays put and progress→button fit on screen through every kind of scan; buzzes
node test/browser/camera-revive.js        # camera un-freezes after Clear all / a pause / being shut off; stays off once closed
node test/browser/backstock-fullpack.js # Full pack sale mode: ?mode=fullpack, pop-up, Sell/Cancel, refusals, draft kept (real backend code)
node test/browser/full-packs.js          # Full pack sales page: totals, cards, Undo, none after close, empty month (real backend code)
node test/browser/home-pill.js            # back pills: Home pill (Slots owner only, Settling, Full pack sales, Shift Closure); every back pill page keeps the name pill top right
node test/browser/try-again.js            # Try again on Slots, Back stock, Months when loading fails; Back stock camera starts after
node test/browser/sw-offline.js           # real service worker: every file saved on install; offline Slots shows Try again
node test/browser/sw-cache-first.js       # real service worker: opens with no answer from the server; a deploy downloads as one set (?v=), shows from the next page, old set deleted; back to the front checks
node test/db/run.js                       # database: store separation, sign-in and permission checks (dev project, rolled back)
for t in test/parity/*.js; do [ $t = test/parity/harness.js ] || node $t; done   # Sheets vs Supabase: identical answers (dev project)
node test/browser/retailer-number.js     # More → Retailer Number (owner only, pop-up, refusals) and the number on the Theft Report (screen, text, PDF; owner + employee)
node test/browser/db-sign-in.js           # pages on BACKEND 'supabase' against a dev test store: email sign-in, Forgot Password, invite → Resend Invite → set password, change password, token renewal, owner sets password / turns off
node test/sw-version.js                   # CACHE bumped after any change to a saved file (--update records it); every page/script is in SHELL
node test/browser/settling.js             # Settling: 50+ day packs, order, colors, totals, drop off when ended, owner only
node test/browser/shift-close.js          # Close shift: start tickets, earlier sold out, once a day for employees, no $, Close Day untouched (real backend code)
node test/browser/shifts.js               # Shift Closure report: by day, details, ended packs, Delete (real backend code)
node test/browser/slot-end-cancel.js      # slot page Sold out / Returned: sold-today numbers before saving, Cancel from every step, nothing saved
node test/browser/ticket-order.js         # Slots arrows, slot page Ticket order, More Set all, Close Day / return refusals (real backend code)
node test/browser/reports.js              # Reports tab: list with numbers, Shipments Received + Returned Packs cards, ‹ Reports pills (real backend code)
node test/browser/theft-report.js         # Theft Report page: choice, tables, Share/copy, PDF (bytes, xref, multi-page), print fallback, Try again, employee without $, no permission → home
node test/browser/month-download.js       # Months on the database backend: Download Month makes the Excel file (tabs, rows, $ format), share or download; no Start
node test/browser/theft-fab.js            # Home's red Theft Report button: owner + employees with the permission, above the tab bar, never hides the last row, opens the report
node test/browser/close-yesterday.js      # Close Yesterday: Home button (employee/owner), Close Day banner, late close + summary, owner reopen, blocked reason, gone at noon (real backend code)
node test/parity/missed-day.js            # missed day + Close Yesterday on Sheets vs Supabase: offered/blocked/refused, totals incl. the missed day's sold outs, reopen, full pack undo
node test/browser/activation-date.js      # slot page Activation Date: owner only, under Pack Size, days follow, year typo refused, none for an empty slot (real backend code)
node test/parity/activation-date.js       # setActivationDate on Sheets vs Supabase: owner only, date checks, days, that night's close unchanged
node test/import-check.js                 # the import end to end: 2 made-up months on Sheets → export → rebuilt months answer the same → rows → dev test store → 23 reads the same
node test/browser/splash.js               # launch screen: letter order + cursor, barcode opens with the beam, waits for Home's numbers, 8 s limit, once per open, Sign In, Home signed out / expired passes on without drawing, small phone, reduced motion
node test/browser/disclaimer.js           # third-party disclaimer: Sign In small print, More → About (owner + employee), no "CA Lottery" in src pages
node test/browser/permissions.js          # employee permissions: Manage employees switches, employee home links, slots/slot page/back stock per permission, no $

npx @google/clasp push -f                 # push backend (clasp isn't installed globally; already logged in)
npx @google/clasp update-deployment AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ -d "<what changed>"
git push origin main                      # publishes the pages (GitHub Pages, ~1 min)
```
Browser tests (`test/browser/harness.js`) serve `src/` locally, open pages in headless Chrome at phone size, sign in,
and answer backend calls with a fake (`openApp({ role, handle })`) or with the real `src/apps-script` code on an
in-memory spreadsheet (`backendInVm`). They never touch the live backend. Deploy the backend before the pages when a
page needs a new action. Pages: bump `CACHE` in sw.js + `node test/sw-version.js --update` before every pages push. After deploying, `curl -sL "$URL"` should return `{"ok":true,...,"slots":48}`, and an
unknown-but-registered action should answer `unauthorized` (not `unknown_action`).
