#!/bin/sh
# Gives the support Edge Function (Report a Problem) its email secrets on the linked Supabase project: the Gmail
# address + app password from ~/.smart-scan/smtp.env and the support address from ~/.smart-scan/support.env
# (SUPPORT_EMAIL=...). Both files stay on this Mac, never in the repo (it's public).
#   sh scripts/push-function-secrets.sh
set -e
SMTP_FILE="$HOME/.smart-scan/smtp.env"
SUPPORT_FILE="$HOME/.smart-scan/support.env"
[ -f "$SMTP_FILE" ] || { echo "Missing $SMTP_FILE"; exit 1; }
[ -f "$SUPPORT_FILE" ] || { echo "Missing $SUPPORT_FILE"; exit 1; }
# Read, not sourced: the app password may be saved with spaces, and Gmail wants it without them.
SMTP_USER=$(sed -n 's/^SMTP_USER=//p' "$SMTP_FILE" | tr -d ' "\r')
SMTP_PASS=$(sed -n 's/^SMTP_PASS=//p' "$SMTP_FILE" | tr -d ' "\r')
SUPPORT_EMAIL=$(sed -n 's/^SUPPORT_EMAIL=//p' "$SUPPORT_FILE" | tr -d ' "\r')
[ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ] && [ -n "$SUPPORT_EMAIL" ] || { echo "SMTP_USER, SMTP_PASS and SUPPORT_EMAIL must be filled in"; exit 1; }
cd "$(dirname "$0")/.."
# A temporary file only this user can read, removed right after.
TMP=$(mktemp); chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
printf 'SMTP_USER=%s\nSMTP_PASS=%s\nSUPPORT_EMAIL=%s\n' "$SMTP_USER" "$SMTP_PASS" "$SUPPORT_EMAIL" > "$TMP"
npx --yes supabase@2.122.0 secrets set --env-file "$TMP"
