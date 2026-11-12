#!/bin/sh
# Pushes supabase/config.toml's auth settings (password rule, links, emails) to the linked Supabase project.
# The Gmail address and app password come from ~/.smart-scan/smtp.env (never in the repo); without them the push would
# save the words "env(SMTP_PASS)" as the password and every email would stop, so this refuses instead.
#   sh scripts/push-auth-config.sh        (answer only the auth prompt; it shows the changes first)
set -e
ENV_FILE="$HOME/.smart-scan/smtp.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
# Read, not sourced: Google shows the app password in groups of four with spaces, and Gmail wants it without them.
SMTP_USER=$(sed -n 's/^SMTP_USER=//p' "$ENV_FILE" | tr -d ' "\r')
SMTP_PASS=$(sed -n 's/^SMTP_PASS=//p' "$ENV_FILE" | tr -d ' "\r')
export SMTP_USER SMTP_PASS
[ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ] || { echo "SMTP_USER and SMTP_PASS must be filled in $ENV_FILE"; exit 1; }
cd "$(dirname "$0")/.."
# Dev is on the Free plan, which refuses [auth.sessions] (the 12-hour sign-in limit, prod only) and with it the whole
# auth push. So dev gets a copy of the settings without that section. For prod, push by hand with --project-ref
# (docs/supabase.md); the full file applies there.
COPY=$(mktemp -d)
trap 'rm -rf "$COPY"' EXIT
mkdir "$COPY/supabase"
cp -R supabase/templates supabase/.temp "$COPY/supabase/"
sed -e 's/^\[auth\.sessions\]$/# [auth.sessions]/' -e 's/^timebox = "12h"$/# timebox = "12h"/' supabase/config.toml > "$COPY/supabase/config.toml"
npx --yes supabase@2.122.0 config push --workdir "$COPY"
