# Smart Scan: code map (pages, backend files, UI conventions)

Moved out of CLAUDE.md on 2026-10-29. Read the part for the page or backend file you are changing.

Frontend (`src/`, plain HTML + JS, no build):
- `config.js` backend URL and `STORE_NAME` (header eyebrow in nav.js, Theft Report) · `api.js` `api(action, params)`, session in localStorage, `requireLogin(role)`, `whileBusy`,
  and the unsent close (`getPendingClose`, `savePendingClose`, `sendPendingClose`, `canRetryClose`, `newCloseId`;
  one per phone in `smartScanPendingClose`)
- `barcode.js` `parseTicketBarcode`, `parsePrintedTicket`, `STANDARD_PACK_SIZES` · `scanner.js` shared camera
  (zxing-wasm, `startScanner({... mode})` → `{ setMode }`) · `style.css` shared styles
- **UI touch-ups (2026-10-29, owner's design rule):** Reports tab = grouped lists like More ("This Month": Months & Totals,
  Shipments, Returns with their numbers shrunk to fit, not repeating "This Month"; "After a Theft": Theft Report with a red
  icon tile). Sign In = app icon + name, fields in `.auth-card`, Forgot Password? under the password (database), small
  print centered. **Every password field gets an eye** (`addPasswordEyes` in nav.js wraps it in `.password-field`; the eye
  is `type="button"`, so pages and tests pick the submit with `button[type="submit"]`). New-password fields show the rule
  as a checklist (`<ul class="password-rule">` right after the field → `showPasswordRule(el)` in api.js, built from
  `PASSWORD_CHECKS`, the same list `passwordProblem` uses; aria-label = PASSWORD_RULE). Change My Password has a More back pill.
  Manage Employees: a short intro, a green **Add Employee** button (`#addOpen`) opening the add form as a pop-up
  (`#addDialog`, `.form-dialog`; Cancel clears it; errors stay in it as `#addMessage`; once added it closes and the
  page says so), a `.member-card` per person (initials, name, email, status chip: Owner green `live`, Invited amber
  `days`, Inactive red `warn`), actions in `.member-actions`, one-line permission descriptions. `#listMessage` floats
  above the tab bar (`.toast-wrap`, fades after 5 s / errors 9 s, tap to dismiss) so flipping a switch never moves the list.
  Slot page (`activate.html`): a summary card on top (`#slotInfo.slot-hero`: tickets left in green or Out of Stock in
  red, then `$20 Slot · Game 1747 · ↓ Descending`), the main job under it (end a pack / scan one in, unchanged), and the
  settings in a **Slot Settings** grouped list (`#settingsGroup`: Slot Price, Ticket Order, Pack Size, Activation Date,
  Move or Swap, each row with its current value). Each row opens its own pop-up (`#priceDialog` … `#swapDialog`) holding
  the old form with the same ids; **a form's `hidden` class still says whether this person may use it, and its row shows
  only then** (`renderSettings`; the group hides with no rows, e.g. Load Packs only). Saving closes the pop-up and floats
  the message (`#settingsToast`; the form's own message keeps the words); a refusal keeps it open. Tests tap the row
  (`#activatedRow`, `#orderRow`) first and submit with `button[type="submit"]`.
  **iPhone date fields:** Safari draws `input[type="date"]` wider than its box, so it has `appearance: none` (style.css; same
  height, date on the left, the picker still opens) and form pop-ups have `overflow-x: hidden` — the Activation Date pop-up
  scrolled sideways before. Owner checked all of these touch-ups on the phone 2026-10-29: good.
- **Design rule (owner 2026-10-29):** every UI change is designed like a senior UI designer with 20+ years would: clean,
  clutter free, modern, professional, user friendly. Decide hierarchy and grouping first; check a phone-size screenshot.
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
  `backstock.html?mode=…`; Theft Report → `theft-report.html`); no dollars. · `more.html` (**redesigned 2026-10-29**, owner: "looked generic"): a profile card (`.profile-card`: big initials, name, Owner/Employee chip, the sign-in email on the database), then grouped inset lists (`.group-block` > `.group-label` + `.group` of `.group-row`s: icon tile — green `accent` for Store —, title, one-line `.row-sub` hint, chevron, hairline dividers between visible rows only): **Store** (owner; an employee sees it only with Ticket Order), **Support** (Help & FAQ, Scanner Test, About), **Account** (Change My Password), then a quiet centered red **Sign Out** row and `Smart Scan · Version N` (newest `smart-scan-vN` in `caches.keys()`); test/browser/more.js. Rows: **Retailer Number** (owner only: a pop-up that asks for the number only when
  opened, Cancel / Save; `getRetailerNumber` / `setRetailerNumber`; icon `store`), Ticket order (owner / `ticket_order`: pop-up All descending / All ascending, Cancel / Save), Scanner test, Change my password, Sign out ·
  `login.html` (Email + Forgot Password? on the database) · `set-password.html` (database: invite / password email links) ·
  `setup-owner.html` · `account.html` · `users.html` (owner; on the database an employee is added by username + email; each employee card has a switch per permission,
  `.perm-row` + `input.toggle` in style.css, saved at once with `setUserPermissions`, plus Turn All On/Off; folded under a
  "Permissions · N of 7 on" row, `details.perm-details`, closed at first and kept open across saves — owner 2026-10-08)
- **Help & FAQ** (owner 2026-10-29; wording approved in the shared doc https://claude.ai/artifact/ARsEt2WzZjMjpJPYHzMSTD):
  `help.html` (More → Help & FAQ, everyone) shows `faq.js`: 10 sections, each item `{ id, who, backend?, go?, q, a }` in
  **English, Spanish and Arabic** (`HELP_LANGS`; the picker at the top, remembered per phone in `smartScanHelpLang`;
  Arabic `dir="rtl"`). Translations shipped as written (owner's choice); **button names stay in English** in every
  language so they match the screens. `faqVisible`: the owner sees all; an employee sees `everyone` / `employee` items and
  those for a permission they have; `backend: 'sheets' | 'supabase'` items show only on that backend (sign-in,
  passwords, months) so the right answer shows by itself after the cutover. Search (every typed word, accents and Arabic
  vowel marks ignored, also matches the English). Answers: a line per paragraph, `1. ` lines = numbered list, `- ` = bullets;
  `go` = a Go There button. **Never a `$` in anything an employee can see** (the password rule's signs aside).
  Pages with `data-help="<section>"` on the header get a small round **?** beside the title (`.title-row`, nav.js), which
  opens `help.html?from=<this page>&section=<id>`: back pill to that page (only the ? pages are allowed as `from`),
  that section marked. ? pages: Close Day (`close`; Close Shift → `shift`), slot page (`packs`), Back Stock (`backstock`),
  Employees (`employees`), Theft Report (`reports`).
  **When a feature, button name or rule changes, update its answer in faq.js (all three languages) in the same change.**
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
