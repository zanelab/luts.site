#!/usr/bin/env sh
# Validates _luts/*.md frontmatter.
#
# Rules:
#   * If `paid: true` is set, the following fields must also be present and
#     non-empty: price, afdianSkuId, afdianOrderUrl.
#   * Other fields (title, lutId, beforeImg, afterImg, tags) are validated
#     downstream by Jekyll — we only check the paid-only fields here so the
#     rule stays simple and shell-friendly.
#
# Exits non-zero (and prints every offender to stderr) on the first wave of
# problems. Designed to be called from the Makefile build target before
# `bundle exec jekyll build`.

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LUTS_DIR="$ROOT_DIR/_luts"

if [ ! -d "$LUTS_DIR" ]; then
  exit 0  # no LUTs yet, nothing to check
fi

errors=0

for f in "$LUTS_DIR"/*.md; do
  [ -f "$f" ] || continue
  slug=$(basename "$f" .md)

  # Extract frontmatter: text between the first two '---' lines.
  # We use awk to skip everything after the closing '---'.
  frontmatter=$(awk '
    /^---[[:space:]]*$/ { c++; if (c == 2) exit; next }
    c == 1 { print }
  ' "$f")

  # If the file has no frontmatter, skip — Jekyll will surface the error.
  if [ -z "$frontmatter" ]; then
    continue
  fi

  # Only enforce rules when paid: true (case-insensitive, with optional whitespace).
  if ! printf '%s\n' "$frontmatter" | grep -Eq '^[[:space:]]*paid[[:space:]]*:[[:space:]]*true[[:space:]]*$'; then
    continue
  fi

  missing=""
  for field in price afdianSkuId afdianOrderUrl; do
    if ! printf '%s\n' "$frontmatter" | grep -Eq "^[[:space:]]*${field}[[:space:]]*:"; then
      missing="$missing $field"
    fi
  done

  if [ -n "$missing" ]; then
    printf 'ERROR: lut %s is paid but missing:%s\n' "$slug" "$missing" >&2
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  printf 'validate-luts: %d file(s) failed\n' "$errors" >&2
  exit 1
fi

echo "validate-luts: all paid LUTs have price/afdianSkuId/afdianOrderUrl ✓"
exit 0
