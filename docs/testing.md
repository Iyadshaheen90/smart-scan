# Smart Scan: tests and deploy

Moved out of CLAUDE.md on 2026-10-29. Pick the tests that cover the change; the full list is below.

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
node test/browser/auth-look.js           # Sign In look, eye on password fields (not a submit), password checklist ticks, Change My Password back to More and saves
node test/browser/more.js                # More tab: profile card, Store/Support/Account groups per role, dividers, version, long names fit
node test/browser/help.js                # Help & FAQ: faq.js data (3 languages, who, permissions covered, go pages, no $ for employees, data-help sections), owner/employee views, search, languages + RTL, ? buttons + back pill
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
