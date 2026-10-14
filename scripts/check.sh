#!/bin/sh
# Check the examples and documentation. Skillforge validates frontmatter.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
fail=0

for tool in bash go jq node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is not on PATH" >&2
    exit 1
  fi
done

# vitest 5 needs Node 22.12 or later.
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
  echo "error: Node $(node --version) is too old; the examples need 22.12 or later" >&2
  exit 1
fi

# TypeScript examples: one npm project per skill, type-checked against the
# pinned @cloudflare/workers-types, with vitest for behavior.
for pkg in "$root"/examples/*/package.json; do
  [ -f "$pkg" ] || continue
  dir=$(dirname "$pkg")
  name=${dir#"$root"/}
  echo "== $name: npm ci"
  if ! ( cd "$dir" && npm ci --silent --no-audit --no-fund ); then
    echo "error: $name npm ci failed" >&2; fail=1; continue
  fi
  echo "== $name: tsc"
  if ! ( cd "$dir" && npx --no-install tsc -p . ); then
    echo "error: $name type checks failed (see diagnostics above)" >&2; fail=1
  fi
  echo "== $name: vitest"
  if ! ( cd "$dir" && npx --no-install vitest run ); then
    echo "error: $name tests failed (see output above)" >&2; fail=1
  fi
done

echo "== REST shell snippets against a fake curl"
bash "$root/scripts/test-rest-guard.sh" || { echo "error: a REST snippet kept going after a failure or printed a token" >&2; fail=1; }

# Go examples: each go.mod under examples/ is its own module.
for mod in $(find "$root/examples" -name go.mod -not -path '*/node_modules/*'); do
  dir=$(dirname "$mod")
  name=${dir#"$root"/}
  echo "== $name: gofmt"
  unformatted=$(cd "$dir" && gofmt -l .)
  if [ -n "$unformatted" ]; then
    echo "$unformatted"
    echo "error: run gofmt -w on the files listed above" >&2; fail=1
  fi
  echo "== $name: vet"
  ( cd "$dir" && go vet ./... ) || { echo "error: $name vet failed" >&2; fail=1; }
  echo "== $name: test"
  ( cd "$dir" && go test ./... ) || { echo "error: $name tests failed" >&2; fail=1; }
done

echo "== sweeping markdown for em and en dashes"
if grep -rn --include='*.md' --exclude-dir=.claude --exclude-dir=.git --exclude-dir=node_modules -e "$(printf '\342\200\224')" -e "$(printf '\342\200\223')" "$root" | grep -v '/\.skill-quality/'; then
  echo "error: prohibited em or en dash in the files listed above" >&2; fail=1
fi

echo "== checking code fences against their example files"
# The first line of every ts or go fence in a skill or reference is either
#   // examples/<path>     (trimmed from that file)
#   // excerpt ...         (API sketch, no example file)
# Every other non-blank line of a trimmed fence must appear in the named file,
# ignoring indentation and a leading "export ", so the prose cannot drift from
# code that compiles.
for f in "$root"/skills/*/SKILL.md "$root"/skills/*/references/*.md; do
  [ -f "$f" ] || continue
  awk -v root="$root" '
    function norm(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); sub(/^export (default )?/, "", s); return s }
    /^```(ts|go)$/ {
      start = FNR
      if ((getline line) <= 0) { printf "%s:%d: unterminated fence\n", FILENAME, start; bad = 1; exit }
      src = ""
      if (line ~ /^\/\/ examples\/[^ ]+( |$)/) {
        p = line; sub(/^\/\/ /, "", p); sub(/ .*/, "", p)
        # Read the file directly instead of shelling out, so a crafted path cannot run a command.
        src = root "/" p
        delete have; n = 0
        while ((getline l < src) > 0) { have[norm(l)] = 1; n++ }
        close(src)
        if (n == 0) { printf "%s:%d: no such example file %s\n", FILENAME, start, p; bad = 1; src = "" }
      } else if (line !~ /^\/\/ excerpt/) {
        printf "%s:%d: fence must start with // examples/<path> or // excerpt\n", FILENAME, start; bad = 1
      }
      while ((getline line) > 0 && line !~ /^```/) {
        if (src != "" && norm(line) != "" && !(norm(line) in have)) {
          printf "%s:%d: line not in %s: %s\n", FILENAME, FNR, p, norm(line); bad = 1
        }
      }
    }
    END { exit bad }' "$f" || fail=1
done

if [ "$fail" -ne 0 ]; then
  echo "Repository checks failed. Fix the reported errors and rerun skillforge check ." >&2
  exit 1
fi
echo "All repository checks passed."
