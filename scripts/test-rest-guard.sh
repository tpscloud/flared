#!/usr/bin/env bash
# Run the REST setup and create snippets from rest-api.md against a fake curl,
# and check that every failure stops the script and no response leaks the token.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
doc="$root/skills/cloudflare-artifacts/references/rest-api.md"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The bash fence that contains a given line.
fence() {
  awk -v want="$1" '
    /^```bash$/ { inside = 1; buf = ""; next }
    /^```/ && inside { inside = 0; if (hit) { printf "%s", buf; exit } next }
    inside { buf = buf $0 "\n"; if (index($0, want)) hit = 1 }' "$doc"
}
fence 'cf() {' >"$tmp/setup.sh"
fence 'REMOTE=$(jq -er' >"$tmp/create.sh"
[ -s "$tmp/setup.sh" ] && [ -s "$tmp/create.sh" ] || { echo "error: snippets not found in $doc" >&2; exit 1; }

mkdir "$tmp/bin"
cat >"$tmp/bin/curl" <<'FAKE'
#!/bin/sh
[ -n "$FAKE_BODY" ] && printf '%s' "$FAKE_BODY"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$tmp/bin/curl"
{ cat "$tmp/setup.sh" "$tmp/create.sh"; echo 'echo "REMOTE=$REMOTE"'; } >"$tmp/run.sh"

fail=0
# expect <name> <want: ok|stop> <curl exit> <body>
expect() {
  local out code=0
  out=$(PATH="$tmp/bin:$PATH" FAKE_EXIT="$3" FAKE_BODY="$4" bash "$tmp/run.sh" 2>&1) || code=$?
  if [ "$2" = stop ] && { [ "$code" -eq 0 ] || [[ $out == *REMOTE=* ]]; }; then
    echo "FAIL $1: kept going (exit $code): $out" >&2; fail=1
  elif [ "$2" = ok ] && [[ $out != *"REMOTE=https://r"* ]]; then
    echo "FAIL $1: no remote (exit $code): $out" >&2; fail=1
  elif [[ $out == *SECRET_TOKEN* ]]; then
    echo "FAIL $1: printed the token: $out" >&2; fail=1
  else
    echo "ok   $1"
  fi
}
ok='{"success":true,"errors":[],"result":{"name":"trunk","remote":"https://r","token":"SECRET_TOKEN"}}'
expect "success" ok 0 "$ok"
expect "success false" stop 0 '{"success":false,"errors":[{"code":10201,"message":"exists"}],"result":null}'
expect "http error" stop 22 '{"success":false,"errors":[{"code":10000,"message":"auth"}],"result":null}'
expect "transport error" stop 6 ''
expect "malformed json" stop 0 'not json'
expect "missing remote" stop 0 '{"success":true,"errors":[],"result":{"name":"trunk","token":"SECRET_TOKEN"}}'
exit "$fail"
