# Smart Scan: Supabase (database move, in progress; the app still runs on Sheets until the Dec 1, 2026 cutover)

Moved out of CLAUDE.md on 2026-10-29. Read before any database, sign-in, email or import work, and when a new backend action needs porting.

Plan: `~/.claude/plans/submitting-reports-and-updating-mossy-floyd.md`. Account: the owner's own **iyadshaheen90@gmail.com**
(the product is theirs; Route 66 Liquor is its first store). Dev project **`smart-scan-dev`** (ref `kqoenvgcbypnehmjefjx`,
West US, Free; since 2026-11-10 in its own Free org **Smart Scan Dev** so it costs nothing) — test data only. Prod project **`smart-scan-prod`** (ref `ulxiphcgningbjgrvdui`, West US, Micro, org **I.S Technology LLC** on Pro, made 2026-11-10; DB password in `~/.smart-scan/prod-db.env`). The folder stays **linked to dev**: every prod command names it with `--project-ref ulxiphcgningbjgrvdui` (db push also `-p` the password; advisors need `--db-url` via the pooler `aws-0-us-west-1.pooler.supabase.com:5432`, user `postgres.<ref>`). The two scripts push to the linked project, so for prod run their commands by hand with `--project-ref`. Prod has all 21 migrations, the auth config (same diff as dev: only the pooler sizes), members + support functions (same code hashes as dev) and the 3 secrets; no store or users yet. No local Supabase (this Mac can't run Docker): tests run on
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
- `delete_shift_close` takes `shiftIds` too (migration 0021, 2026-11-06), same as Sheets; covered by `test/parity/shifts.js`.
- **Activate Several (migration 0025, 2026-11-11; database only, no Sheets version):** `activate_several { packs: [activate_pack
  requests], check? }` runs each row through `public.activate_pack` in its own sub-transaction (same checks and
  messages), in order; a refused row → `{ ok: false, code, message }` (only app errors with a hint; others re-raise),
  plus `pick_slot`, `slot_twice`, `pack_twice`; good → `{ ok: true, …activate_pack's answer }`. `check` or any refused
  row → everything thrown away (custom SQLSTATE SS001), `saved: false`; max 48 rows. `undo_activate_several { slots:
  [{ box, slot, oldPack }] }`: last first, undo_activation then undo_end_pack when oldPack; all or nothing, a refusal is
  prefixed "Box b, slot s:". Both need load_packs. Test: `supabase/tests/activate_several_test.sql`.
- **Shipment pack numbers (migration 0026, 2026-11-11; owner's rule: a pack number of a game is never entered twice,
  and a live pack never goes into back stock):** `save_back_stock` shipment lines take `packNumbers` (7 digits, at most
  `packs`); those go in `app.packs` as `in_back` with `received_on` + `shipment_id`, the rest add to `unnumbered_in_back`.
  A number the database already has (any status; the table's unique game+pack) → `pack_used` "Pack g-p is already in the
  back (received …) / is live in box b, slot s / already sold out on … / was returned on … / was sold as a full pack on … /
  was taken out of back stock on … (reason)"; twice in one shipment → `pack_twice`; checked before anything is written, so
  nothing is saved. Count mode ignores them. Sheets ignores `packNumbers` (counts only; owner careful until Dec 1).
  Test: `supabase/tests/shipment_pack_numbers_test.sql`. **Status: LIVE on dev + prod 2026-11-11 (owner's OK; owner smart_scan_api, authenticated only).**
- **Sign-ins end on the server after 12 hours (2026-11-12, prod only, owner's OK):** `[auth.sessions] timebox = "12h"` in config.toml, pushed to prod with `config push --project-ref …` (only that line differed). It matches the app's 12 hours, so a copied refresh token dies with the sign-in. The Free dev project refuses it (402), so `scripts/push-auth-config.sh` pushes dev a copy without that section.
- **Review fixes (migration 0027, 2026-11-12; `docs/db-review-2026-11.md`):** `reopen_close` deletes and restores only close
  lines of packs still live (newest first); `app.counted_out(pack)` = removed with reason count / adjust: `activate_pack`
  (same row goes live; takes an unnumbered pack if there is one), `sell_full_pack` (needs an unnumbered pack) and
  `save_back_stock` shipments (`on conflict` → in_back again) accept such a pack. Tests: `test/parity/reopen-ended.js`,
  `supabase/tests/counted_out_packs_test.sql`. **Status: LIVE on dev + prod 2026-11-12 (owner OK; all db + parity tests pass on dev); Sheets backend @42.**
- **Many stores, steps 1-3 (migration 0028, 2026-11-12; design `~/.claude/plans/smart-scan-multi-store-design.md`):**
  review finding 3 fixed at the root: the `own_rows` (store_members) and `my_stores` (stores) policies apply only while
  **no store is entered** (`app.current_store_id() is null`), so inside a store only its rows show; `enter_store` leaves
  any earlier store first (tests make several calls in one transaction); `users_json`, `set_user_permissions`,
  `member_admin_check` also name the store. `my_stores` rows add `storeNumber`, `timeZone`, `dayEndHour`.
  `activate_several`'s cap = the store's slot count. **`create_store(req)`** (any signed-in account; no `p_store`):
  `{ name, street, city, state, zip, phone, username, lotteryState, timeZone, dayEndHour, ticketOrder, boxes: [[price…]…],
  retailerNumber? }` → the store, the caller as owner (email from the JWT), every slot, the retailer number, all or
  nothing; limits 3 a day and 10 owned per account (`too_many_stores`); states `app.supported_states()` (CA), prices
  `app.slot_prices()` (1 2 3 5 10 20 30 40), 1-20 boxes, 1-100 slots a box. Shared checks `app.store_info_checked`
  (set_store_info uses it too) and `app.store_hours_checked`. Owner: `store_settings` / `set_store_settings
  { timeZone, dayEndHour, ticketOrder }` (hours refused with `day_started` once today has a close or shift close, or
  when the new hours land on a closed day; ticketOrder = for slots added later), `add_slots { box, count, price }`
  (end of a box, or the next box number), `remove_slot { box, slot }` (last slot of its box, empty), `remove_box { box }`
  (last box, all empty); never renumbered; a store keeps one slot. `test_claim_store(store)` (service key): a store
  under an hour old whose people all have `@test.invalid` emails becomes a test store, so `test_drop_store` can remove
  what a wizard test made. **Status: LIVE on dev + prod 2026-11-12 (owner OK; prod audit clean).** Not built yet: the subscription row, Store Settings / Edit Layout pages, the store
  chooser, inviting an existing account, deletion. Test: `supabase/tests/many_stores_test.sql`.
  **Pages:** `config.js` `SIGN_UP_OPEN` (false: nothing changes); with it true on the database, Sign In shows Create
  Account (`signup.html` → Supabase Auth sign-up, the confirm link opens `setup.html`), and a session without a store
  (`needsStore`, `storeId: null`) is sent to `setup.html` by `requireLogin`. api.js: `signUp`, `sessionFromLink`,
  `createStore` (saves the store into the session), `storeFields`, `storeName()`, `storeToday()`.
  Before opening sign-up: Supabase Auth public sign-up on with email confirmation, a confirmation email template, our
  own email domain, `setup.html` in the redirect list.
- **Many stores, steps 4-5 (migration 0029 `switch_stores_and_deletion`, built 2026-11-14; deployed or not: see PROGRESS):**
  **Database:** `service_account_info({ email } | { userId })` → `{ userId, email, stores }` (service key only, owned by
  postgres: reads auth.users and counts memberships across stores; in db-audit's allowed list). `member_admin_check`:
  invite also answers `storeName`, setPassword also `email`. `service_add_member` refuses an account already on the store
  (`email_exists`). `leave_store` (not the owner: `owner_cant_leave`; deletes the caller's own member row),
  `delete_store { name }` (owner; the typed name must match, else `wrong_name`; deletes every row of the store, its
  members and the Vault retailer number; problem reports go with the store row; answers `screenshotReports`),
  `account_delete_check()` (no store; `owns_store` names the stores the account owns, else `{ stores }`).
  Test: `supabase/tests/switch_and_deletion_test.sql`.
  **members Edge Function:** `invite` first asks `service_account_info`: an email that already has an account is added
  with `service_add_member` and gets a plain "You Were Added to <store>" email (`members/mail.ts`, Gmail SMTPS 465 with
  the same SMTP_USER / SMTP_PASS secrets as support; a test store gets `testEmail` back instead) → `{ data, existing,
  emailed }`. **Reset Password rule:** `passwordHelp` → `{ how: 'set' | 'email' }` (email when the account is on more than
  one store); `setPassword` refuses such an account (`shared_account`); `sendReset` sends Supabase's recovery email (test
  store: `testLink`). `deleteStore { name }` calls `delete_store` as the owner, then removes the store's screenshots from
  the `problem-screenshots` bucket. `deleteAccount { password }`: `account_delete_check`, the password checked by signing
  in, then the Auth admin delete (memberships go by the foreign key).
  **Pages (api.js):** the session holds `storeCount`; `dbSessionFor` picks the only store, else the one this phone used
  last (`smartScanLastStore:<email>`), else none → `stores.html` (`startPage(session)`: index / stores / setup, or
  delete.html for a store-less account while sign-up is closed). `enterStore(store, count)` = the switch: refused with
  `pending_close`, clears the other store's saved answers and drafts (`STORE_WORK_KEYS`), remembers the store.
  `leaveCurrentStore(stay)` after the store is lost; `dbApi` on `forbidden` asks `my_stores` and moves the phone if it
  is no longer on that store. Actions: `myStores`, `inviteUser` (`{ users, existing, emailed }`), `passwordHelp`,
  `sendPasswordReset`, `leaveStore`, `deleteStore`, `accountDeleteCheck`, `deleteAccount`. Leave / Delete and Set Up
  Another Store show only with `SIGN_UP_OPEN`; Store Settings, Edit Layout and Switch Store show on the database.
  Not built: sign-in by username (design), the subscription row and the "cancel the subscription first" block on
  Delete Store (subscriptions build), auth settings for sign-up (needs our own email domain).
- **Owner's rule (2026-10-23): every feature added during the move goes into the Supabase version too.** Pages and buttons
  carry over unchanged; a new or changed backend action, field, permission or rule must be ported (with a parity test) or
  added to the migration plan's "Added during the move" checklist — and say so in the summary to the owner.
- **One phone on the database before the cutover (built 2026-11-10, sw v58; owner's side-by-side week):** config.js now has the **prod** `SUPABASE_URL` / anon key while `BACKEND` stays 'sheets'. api.js `PHONE_ON_DATABASE` (localStorage `smartScanPhoneBackend` = 'database', only while `PHONE_SWITCH_OFFERED`: BACKEND 'sheets' and a SUPABASE_URL) makes `USE_DATABASE` true on that phone only; `switchPhoneBackend(toDatabase)` refuses while a close is pending, logs out, clears `smartScanSaved:*` / `smartScanOwnerHome:*` (drafts kept), opens Sign In. More → Database Move row (owner on Sheets; anyone on a switched phone), Sign In's Use Sheets Again line, an amber Database chip in every header (nav.js) and on the version line. set-password.html opened from an email link in a browser still on Sheets (iPhone opens links in Safari, whose storage is apart from the home-screen app) switches that browser first. **Since sw v70 (2026-11-12) only for that page:** the switch is taken back at once (sessionStorage `smartScanLinkSwitch` marks it), the password is saved on the database, no database session is saved, and the message says to keep signing in as today (an Android home-screen app shares storage with the browser, so the old behavior would have moved an employee's real work onto practice data). At cutover (BACKEND 'supabase') the key is removed, so a rollback puts every phone back. Help passes the effective backend to faqVisible. Not in Help & FAQ on purpose (owner-only, gone Dec 1). Test: test/browser/phone-switch.js.
- **Sign-in and the `api.js` seam (built 2026-10-26):** `config.js` `BACKEND` ('sheets' until cutover; 'supabase' then,
  back to 'sheets' = rollback), `SUPABASE_URL` / `SUPABASE_ANON_KEY` (empty until cutover, filled with the **prod**
  project's). With 'supabase', `api(action)` → `dbApi`: `public.<snake_case>` with `{ p_store, req }`, the hint → `ApiError`
  code; `DB_ACTIONS` covers what isn't a database function: login (email + password → `my_stores` → session with
  `storeId`, the first store by name — a store chooser is Phase 5), logout (this phone only), forgotPassword, setNewPassword,
  changePassword (checks the current one by signing in, keeps the new sign-in's tokens since a new password ends the
  others), createUser / resetPassword (→ the **members Edge Function**), me, claimOwner (refused). The session keeps the
  access token (1 h) and refresh token; `freshToken` renews a minute early (one renewal at a time), a 401 is retried once,
  `unauthorized` → Sign In. Signed in 12 h, as on Sheets (`DB_SESSION_HOURS`).
  `login.html` asks for Email and shows **Forgot Password?** (no owner setup link). **The phone remembers the last email (owner 2026-11-12, sw v71):** `rememberEmail` / `lastEmail` in api.js (localStorage `smartScanLastEmail`, saved by Sign In and set-password.html, kept after sign-out); Sign In fills it in and puts the cursor in Password. The fields keep `autocomplete="username"` / `current-password`, so the phone's password manager can fill both (Face ID). Sign-in by username is planned after the cutover (multi-store design). `set-password.html` (new) is where invite
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
  `email_sent = 30` an hour (the cutover invites everyone at once). On dev since 2026-10-29: the owner's real test emails
  **landed in Spam** (new sender through a server, supabase.co link, password subject). Until the domain: Not spam +
  contacts + check Spam, Reset Password as the fallback; the domain with SPF/DKIM/DMARC is the real fix.
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
- **Store Info + Report a Problem (owner 2026-10-31; database only, migration 0020, on dev):** every store gets a
  **Store ID** (`stores.store_number`, sequence from 10001, never changed; support's identifier — **never the retailer
  number**) and `street/city/state/zip/phone` (owner: `store_info` / `set_store_info`, every field checked, phone saved as
  10 digits; More → Store Info, `store.html`; later also the setup wizard). `app.problem_reports` (number = id from 1001,
  forced RLS): `report_problem` (anyone; area, 10–2000 letters, 0–3 screenshots, page/appVersion/device/last 5 red
  messages; 10 an hour per person), `my_reports` (owner: the store's; employee: their own; last 50). Service key only:
  `service_problem_for_email`, `service_problem_emailed`, `service_set_problem_status` (signed-in people have no execute).
  **support Edge Function** (`supabase/functions/support`): report_problem as the caller → screenshots to the private
  bucket `problem-screenshots` (`<store>/<number>/<n>.jpg`, service key only) → email to SUPPORT_EMAIL over **Gmail SMTPS
  port 465** (Edge Functions block 25 and 587; 465 checked from dev 2026-10-31), Reply-To the reporter, screenshots
  attached; the report is saved first, so a failed email keeps it (`email_error`). A test store gets `testEmail` back
  instead (or sends for real with `sendTestEmail: true`). Secrets SMTP_USER / SMTP_PASS / SUPPORT_EMAIL only in
  `~/.smart-scan/smtp.env` + `support.env`, set with `sh scripts/push-function-secrets.sh`. Statuses: support runs
  `node scripts/report-status.js <store uuid> <number> received|working|fixed "note"` (the email ends with it; works on **prod** since 2026-11-10, `--dev` for dev test reports). **Status from the email (2026-11-10, migration 0023):** the support email (text + HTML) has Working on It / Fixed / Received buttons → `report-status.html?status=…#<link>` (GitHub Pages; functions can't serve HTML on supabase.co). The link = base64url({s: store, r: report, e: expiry 60 days}) + HMAC-SHA256 with the function secret `STATUS_LINK_SECRET` (dev and prod differ; both in `~/.smart-scan/status-link.env`, set with `secrets set --env-file` `--project-ref`). The page loads with `linkReport`, saves with `linkSetStatus` (note ≤ 300); opening a link changes nothing. No secret = no buttons, only the command. Tests: problem_reports_test.sql (service_problem_for_link), test/browser/db-report.js (links, tamper, page, save). **Clearing fixed reports (2026-11-10, migration 0024):** `problem_reports.cleared_at/cleared_by`; `my_reports` hides cleared ones (`req.cleared` true lists only them); `clear_reports` / `restore_reports` `{ numbers }` (the sender or the owner; clear = Fixed only, all or nothing); one shared list; support moving a report back from Fixed un-clears it. My Reports: Clear on Fixed cards, Clear All Fixed (2+), Undo toast, Show Cleared Reports → Restore. FAQ `clear-reports`.
  Deploy: `npx --yes supabase@2.122.0 functions deploy support --use-api`. Tests: `supabase/tests/problem_reports_test.sql`,
  `test/browser/db-report.js`. Sheets: nothing (More rows, Help link and FAQ answers are database only).
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
  **Prod import (built 2026-11-10, migration 0022):** `node scripts/import-sheets.js prod` runs `check` first (must pass), makes the store once (`service_create_store`, id kept in `~/.smart-scan/prod-store.json`), makes each person's account with the real email via the admin API (**no email sent**; same email = reused), then `service_import_store` and checks every table's count against the check. A store with data (the side-by-side copy) is emptied by `service_clear_store` only after the store's name is typed (Terminal); it keeps the store row (Store Info, Store ID), people (signed_in_at), retailer number and problem reports; the import then updates people from the sheets (upsert) and adds new ones. `node scripts/import-sheets.js invite <username…>|--all` sends the invite emails on prod after typing `send`; anyone already confirmed is skipped (Supabase Auth's /invite resends to an unconfirmed account, refuses a confirmed one, checked in its source 2026-11-10). Test: `supabase/tests/prod_import_test.sql`.
- **Next (owner's decisions pending):** prod project (Supabase Pro $25/month — owner's OK before creating it; its auth
  settings from config.toml, incl. the password rule, pushed with `sh scripts/push-auth-config.sh` linked to prod), the prod
  import (real emails from `~/.smart-scan/members.json`; sends everyone an invite, owner's choice 2026-10-29; before it,
  employees add route66liquor@gmail.com to contacts and check Spam, since the test emails landed there),
  a full side-by-side run with `BACKEND = 'supabase'`, then the final Nov export + import after the Nov 30 close. Later: per-pack shipment scan-in (numbered back stock) and the Theft Report listing those packs.
- **After the cutover: App Store + Google Play launch** (plan `~/.claude/plans/smart-scan-app-store-launch.md`; Phase A, the
  third-party wording, is done). Owner's choices: billing both (in-app via RevenueCat + Stripe web checkout), an LLC as the
  seller, California first then more states, keep the name Smart Scan. Still open: price and trial; whether Route 66 Liquor
  stays on the web app. Needs self sign-up + setup wizard, subscriptions, in-app account deletion, privacy/terms pages, a
  demo store, Capacitor apps with cloud builds (this Mac can't run Xcode 26).
