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
npx --yes supabase@2.122.0 config push
