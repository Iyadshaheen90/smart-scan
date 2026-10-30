# Smart Scan: store facts and business rules

Moved out of CLAUDE.md on 2026-10-29. Read before changing how anything is counted, who may do what, or how a mistake is undone.

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
