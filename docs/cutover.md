# Cutover to the database: Dec 1, 2026 (checklist, written 2026-11-12)

The steps for moving Route 66 Liquor from Sheets to the database, with the gaps the 2026-11-12 rehearsal found. Read
this before any cutover work. The review behind it: `docs/db-review-2026-11.md`. Commands and details: `docs/supabase.md`.

## Gaps found in the rehearsal (fix or accept before Nov 30)

1. **Phones can keep writing to Sheets after the switch.** A new deploy shows "from the 2nd page", and a page left open
   keeps its old code. A phone with a Sheets sign-in that is still good (12 h; the owner signs in around the 11 pm
   close) can save a shift close, an activation or a shipment to Sheets on Dec 1, and the database never sees it.
   **Built and deployed 2026-11-12 (backend @42, pages sw v68; the lock is off): a "moved" lock on the Sheets backend** (`node scripts/import-sheets.js lock`;
   every action except sign-in, the export and the lock answers "Smart Scan was updated. Close the app and open it
   again."), turned on right after the export; `unlock` is for a rollback.
2. **Nothing checks that the Nov 30 close is in the export.** If that close is still waiting on a phone (no
   connection), the export misses it; after the switch the phone sends it to the database, which refuses it as the
   wrong day, and those sales land in Dec 1. **Built 2026-11-12:** `check` prints the newest close in the export; `prod` stops when
   it is older than yesterday and otherwise asks the owner to confirm it is the last close.
3. **Employees need a working sign-in before they open on Dec 1.** Invite emails landed in Spam in the test and the
   links last 24 h. Do the invites on Nov 27–29, not on the night.
4. **Rolling back is only clean before the first save on the database.** After that, whatever was saved on the
   database has to be entered again on Sheets by hand, and Sheets needs December started. So the go / no-go is at
   step 9, not later.
5. **Clear and import are two calls on prod.** If the import fails after the clear, the live store is empty until it
   is run again (the sheets are untouched, and `check` has already proved the same rows on dev). Accepted; don't switch
   until step 7 prints "Everything matches the check".

## Before Nov 30

- [ ] Decide on the fixes in `docs/db-review-2026-11.md` (finding 1 is money; finding 2 starts to matter on Dec 1).
- [x] Sheets "moved" lock (backend @42 + pages sw v68) and migration 0027 (dev + prod) deployed 2026-11-12.
- [x] Owner ran `node scripts/db-audit.js --prod` 2026-11-12: 27 migrations, 1 real store, "Nothing out of place".
      Run it again after any new migration on prod.
- [ ] Prod matches dev: same migrations, `members` + `support` functions deployed, the 3 function secrets and the
      status-link secret set, auth settings pushed (`docs/supabase.md`).
- [ ] Nov 27–29 (needs pages sw v69 or newer, so opening the invite doesn't move a phone to the database):
      `node scripts/import-sheets.js invite --all` (owner types `send`). Each employee adds the store's
      Gmail to contacts, checks Spam, and chooses a password. Run `invite --all` again the next day: everyone should
      be "skipped: already has a password". Anyone left: the owner uses Reset Password on Dec 1 (database).
- [ ] A dry run any evening: `export` (owner, in Terminal) then `check`. It must end with "reads the same as the sheets".
- [ ] Test the rollback once on a test phone or browser: `BACKEND` back to 'sheets' in a local copy opens Sheets sign-in.

## The night of Nov 30 (after the store closes; owner present)

1. [ ] Close Day for Nov 30 on Sheets as usual. On Home, check it shows closed and **no close is waiting to be sent**
       on any phone (the owner's and each employee's who worked that day).
2. [ ] Nobody uses the app from here until step 10.
3. [ ] Owner, in Terminal: `node scripts/import-sheets.js export`.
4. [ ] Owner, in Terminal: `node scripts/import-sheets.js lock` ("The Sheets backend is LOCKED").
5. [ ] `node scripts/import-sheets.js prod` (runs the check first; the owner types the store name to clear the practice
       data, and confirms the newest close is 2026-11-30). It must end with "Everything matches the check".
6. [ ] Owner's OK, then: `BACKEND = 'supabase'` in `src/config.js`, bump `CACHE` in `sw.js`,
       `node test/sw-version.js --update`, run the page tests that cover sign-in, `git push origin main`.
7. [ ] Wait for the new version (`curl` the live `sw.js`: the new `CACHE`).
8. [ ] Owner's phone: open the app twice (the 2nd open has the new version), sign in with email. Check: Home totals
       and Months for September, October and November equal the sheets; Slots shows every live pack with the right
       top ticket; Back Stock counts are right; Manage Employees lists everyone.
9. [ ] **Go / no-go.** Anything wrong: set `BACKEND = 'sheets'`, bump `CACHE`, push, `node scripts/import-sheets.js unlock`. Nothing was
       saved on the database yet, so nothing is lost.
10. [ ] More → Retailer Number: enter it if it's empty (the import can't read the Sheets copy). More → Store Info:
        address and phone.

## Dec 1

- [ ] First employee of the day opens the app twice and signs in with email + the password they chose.
- [ ] After the first shift close and that night's Close Day, the owner checks the numbers against the lottery
      terminal as usual.
- [ ] Start the one-time "scan the back" when convenient, so back stock gets pack numbers.
- [ ] Keep the sheets as they are (read-only archive). Leave the "moved" lock on.

## If something goes wrong after Dec 1 has sales on the database

Don't switch back on your own. Fix forward on the database if possible (every action has an undo; Report a Problem
reaches support). Switching back means: lock off, `BACKEND = 'sheets'`, Start New Month for December on Sheets, and
entering by hand everything saved on the database since the switch (Months → Download gives the Excel of it).
