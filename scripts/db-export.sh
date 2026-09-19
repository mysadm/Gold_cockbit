#!/usr/bin/env bash
# Exports the whole Gold Cockpit database (schema + data) to one plain-SQL
# file that scripts/db-import.sh can restore on another machine.
#
# WARNING: the dump contains AI provider API keys in plaintext. The output
# folder ignores itself in git; still, treat the file like a password. Pass
# --no-keys to leave the llm_providers rows out entirely.
#
# Usage: scripts/db-export.sh [--no-keys] [--out FILE]
# Reads DATABASE_URL from the environment or ./.env (same as the server).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

NO_KEYS=0
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-keys) NO_KEYS=1; shift ;;
    --out) OUT="${2:?--out needs a file path}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  set -a; . ./.env; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set (export it or put it in .env)}"
command -v pg_dump >/dev/null || { echo "pg_dump not found - install the PostgreSQL client tools." >&2; exit 1; }

mkdir -p db-export
printf '*\n' > db-export/.gitignore
OUT="${OUT:-db-export/gold_cockpit-$(date +%Y%m%d-%H%M%S).sql}"

EXTRA=()
[[ $NO_KEYS -eq 1 ]] && EXTRA+=(--exclude-table-data=llm_providers)

umask 077
pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges ${EXTRA[@]+"${EXTRA[@]}"} > "$OUT"

echo "Exported to $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, mode 600)"
if [[ $NO_KEYS -eq 1 ]]; then
  echo "AI providers were NOT included (--no-keys)."
else
  echo "WARNING: this file contains API keys in plaintext. Do not commit or share it."
fi
echo "Copy it to the other machine, then run: scripts/db-import.sh $(basename "$OUT")"
