# Database review before the cutover (2026-11-12)

A full read of the database as it stands after migration 0026 (all 147 functions, 12 tables), the two Edge Functions,
the auth settings and the import, plus tests on a throwaway dev test store. Read this before fixing any finding below
or before the next review. The cutover steps are in `docs/cutover.md`.

## What was checked and passed

- **Who can reach what** (`node scripts/db-audit.js`, dev): every function has a fixed `search_path`; nothing is
  callable without signing in; the 53 functions signed-in people can call are all `security definer`, owned by
  `smart_scan_api`, and start with `app.enter_store` (or check `app.uid()`); service and test functions are service key
  only; postgres owns only the three plain helpers and the four Vault / password functions. Every table is in schema
  `app` with forced row security and policies for `smart_scan_api` only. `smart_scan_api` can't log in, bypass row
  security or create objects.
- **Prod:** the owner ran `node scripts/db-audit.js --prod` on 2026-11-12 after migration 0027: 27 migrations, 1 real
  store, nothing out of place.
- **Storage / Vault / auth:** the screenshots bucket is private with no policies (service key only); Vault is reachable
  only through the three retailer-number functions; public sign-up and anonymous sign-ins are off.
- **Edge Functions:** `members` checks the caller is the store's owner (with the caller's own token) before any service
  key call; `support` saves as the caller first, and the status links are HMAC-signed with an expiry.
- **Writes:** every function that changes packs, sales or stock takes the store lock before it reads what it checks, and
  runs in one transaction (a refusal saves nothing).
- **Import rehearsal:** `node scripts/import-sheets.js check` on the 2026-11-10 export: 1,757 close lines, 79 packs,
  47 closes, 26 reads identical to the sheets.
- Advisors on dev: only the expected warnings (definer functions callable by signed-in people, two policies on
  stores/store_members, 24 h email links).

## Findings

Each was reproduced on a dev test store. Findings 1 and 2 are fixed in migration 0027 + `Close.js` (2026-11-12; see
`docs/supabase.md` for whether it is deployed); finding 3 and the smaller notes are open.

### 1. Reopening a close loses the sales of a pack that ended after it (both backends, money)

Steps: a pack is counted in tonight's close (10 tickets), then marked sold out (or returned, or replaced by activating
another pack in its slot) after the close, then the close is reopened. `reopen_close` / `reopenClose` deletes the
pack's close line, but the pack is no longer live, so its top ticket isn't put back, and the sold-out line (dated the
next day) starts from the closed ticket. Result in the test: the pack had 51 tickets ($255) left; the two days counted
41 tickets ($205). Ten tickets ($50) are in no close. Sheets does the same (`Close.js` reopenClose: "An ended pack
stays ended").

Fix (small, both backends, one parity test): on reopen, keep the close line of a pack that isn't live any more (delete
and restore only lines whose pack is still live). The kept line is counted again when the day is closed again, because
the summary adds every line since the last close.

### 2. A count or removal makes a numbered pack unusable for good (database only, from Dec 1)

Since migration 0026 shipments put packs in the back by number. Count mode, Manage Packs − and Remove (returned,
damaged, …) only know a number of packs, so `app.take_from_back` marks the newest numbered packs `removed`. That pack
number can then never be activated ("was taken out of back stock (count)"), sold whole or received again, even when the
pack is really on the shelf (a miscount corrected later, or a different pack of the game was the one returned). There
is no way back, which breaks the owner's "every action needs a way back" rule.

Test: receive 0000011–13, count 2, count 3 again: packs in back 3, but 0000013 is refused everywhere.

Fix options: (a) activating, selling whole or receiving a pack that was removed by `count` or `adjust` brings it back
(the scan proves it's there), with the count corrected; (b) item F (pick the exact pack by number in Manage Packs) for
returned / damaged / stolen. (a) is a small migration and should be in before many numbered packs exist.

### 3. A person in two stores sees their own row from the other store (multi-store only)

The `own_rows` policy on `app.store_members` (needed by `enter_store` and `my_stores`) also applies inside an entered
store, so queries without a store filter see the caller's memberships elsewhere. Test: the owner of store A, added to
store B as "boss2": `list_users` for A lists boss2, and inviting username "boss2" in A answers "already taken". Other
people's rows never leak. Not reachable today (one store, one account per store); must be fixed before self sign-up.

Fix: add `store_id = app.current_store_id()` to the member queries in `app.users_json`, `member_admin_check`,
`set_user_permissions` (and any new one), plus a db test with one person in two stores.

**Fixed in migration 0028 (2026-11-12; see `docs/supabase.md` for whether it is deployed):** those three queries name
the store, and the two policies themselves now apply only before a store is entered, so a future query that forgets
the filter can't see the other store either. Test: `supabase/tests/many_stores_test.sql`.

### 4. Smaller notes

- `clear_reports` / `restore_reports` / `my_reports` answer a raw cast error for a non-numeric `numbers` item or a
  non-boolean `cleared` (the pages never send those).
- `sell_full_pack` accepts a pack number that isn't 7 digits (as Sheets does), while shipments and activation need 7;
  with numbered back stock it should be 7 too.
- In the multi-store product an owner can set the password of any member of their store through `members`
  setPassword; if one account could belong to two stores, that would let one owner take over the account. Today an
  email with an account is refused on invite, which prevents it; keep that rule or change setPassword in Phase B.
- Dev has leftover test stores from crashed runs (two "Parity Test Store", one "Sign-in Test Store"); harmless.

## Pages review (2026-11-12, same day)

`api.js` (the database seam, sign-in, token renewal, the waiting close), `close.html` (draft, submit, retry),
`login.html`, `set-password.html`, `sw.js`. The close queue is sound: a close is saved on the phone before it is sent,
`closeId` / `shiftId` make a resend safe, a refusal drops it and keeps the scans, and signing out keeps it.

- **Fixed (sw v70): an email link opened before the cutover left the browser on the database.** `set-password.html`
  switched a Sheets browser to the database to use the link and left it there. On Android the home-screen app shares
  storage with the browser, so an employee opening their invite early would then do real shift closes and activations
  on the database's practice data, not the sheets. Now the switch lasts for that page only: the password is saved, no
  database sign-in is kept, the Sheets sign-in is untouched and the message says to keep signing in as today.
  Test: `test/browser/phone-switch.js`.
- **Fixed (sw v70):** a rate-limited token renewal (429) signed the person out; it now counts as "try again".
- **Open, small:** a database error without an app code (a bug, not a refusal) is treated like a server hiccup, so a
  waiting close would retry it forever; the person can still tap Stop Sending. Fix when it ever happens.
- **Done 2026-11-12 (prod, owner's OK):** sign-ins now end on the server after 12 hours too (`[auth.sessions] timebox`),
  so a copied refresh token dies with the app's sign-in. Dev (Free plan) can't have it.
- **Note:** a close waiting on phone A is sent by whoever signs in next on that phone, under their name (same on Sheets).
