# Smart Scan: Supabase (database move, in progress; the app still runs on Sheets until the Dec 1, 2026 cutover)

Moved out of CLAUDE.md on 2026-10-29. Read before any database, sign-in, email or import work, and when a new backend action needs porting.

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
  settings from config.toml, incl. the password rule, pushed with `sh scripts/push-auth-config.sh` linked to prod), the prod
  import (real emails from `~/.smart-scan/members.json`; sends everyone an invite, owner's choice 2026-10-29; before it,
  employees add route66liquor@gmail.com to contacts and check Spam, since the test emails landed there),
  a full side-by-side run with `BACKEND = 'supabase'`, then the final Nov export + import after the Nov 30 close. Later: per-pack shipment scan-in (numbered back stock) and the Theft Report listing those packs.
- **After the cutover: App Store + Google Play launch** (plan `~/.claude/plans/smart-scan-app-store-launch.md`; Phase A, the
  third-party wording, is done). Owner's choices: billing both (in-app via RevenueCat + Stripe web checkout), an LLC as the
  seller, California first then more states, keep the name Smart Scan. Still open: price and trial; whether Route 66 Liquor
  stays on the web app. Needs self sign-up + setup wizard, subscriptions, in-app account deletion, privacy/terms pages, a
  demo store, Capacitor apps with cloud builds (this Mac can't run Xcode 26).
