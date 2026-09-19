#!/usr/bin/env bash
# Restores a dump made by scripts/db-export.sh into THIS machine's database,
# REPLACING its tables. The current contents are backed up first to
# db-export/pre-import-<timestamp>.sql so the import can be undone.
#
# Usage: scripts/db-import.sh DUMP.sql [--yes]
# Reads DATABASE_URL from the environment or ./.env (same as the server).
# Stop the backend first (./start.sh stop) so nothing writes during the import.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DUMP=""
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) DUMP="$arg" ;;
  esac
done
[[ -n "$DUMP" ]] || { echo "Usage: scripts/db-import.sh DUMP.sql [--yes]" >&2; exit 1; }
[[ -f "$DUMP" ]] || { echo "Dump file not found: $DUMP" >&2; exit 1; }

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  set -a; . ./.env; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set (export it or put it in .env)}"
for tool in psql pg_dump; do
  command -v "$tool" >/dev/null || { echo "$tool not found - install the PostgreSQL client tools." >&2; exit 1; }
done

DB_NAME="${DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
ADMIN_URL="${DATABASE_URL%/*}/postgres"

if ! psql "$DATABASE_URL" -qAt -c 'select 1' >/dev/null 2>&1; then
  echo "Database '$DB_NAME' is not reachable; trying to create it..."
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "create database \"$DB_NAME\"" \
    || { echo "Could not create '$DB_NAME'. Check DATABASE_URL and that PostgreSQL is running." >&2; exit 1; }
fi

TABLES=$(psql "$DATABASE_URL" -qAt -c "select count(*) from information_schema.tables where table_schema='public'")
if [[ "$TABLES" -gt 0 ]]; then
  mkdir -p db-export
  printf '*\n' > db-export/.gitignore
  BACKUP="db-export/pre-import-$(date +%Y%m%d-%H%M%S).sql"
  ( umask 077; pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges > "$BACKUP" )
  echo "Existing data backed up to $BACKUP"
fi

if [[ $YES -ne 1 ]]; then
  read -r -p "This REPLACES all data in '$DB_NAME' with the contents of $DUMP. Type 'replace' to continue: " ANSWER
  [[ "$ANSWER" == "replace" ]] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$DUMP" >/dev/null
echo "Import finished."

if [[ -d node_modules ]]; then
  echo "Applying any migrations newer than the dump..."
  npm run --silent migrate
fi

echo
echo "Row counts now in '$DB_NAME':"
psql "$DATABASE_URL" -qAt -c "
  select 'users', count(*) from users union all
  select 'llm_providers', count(*) from llm_providers union all
  select 'scenarios', count(*) from scenarios union all
  select 'wallet_holdings', count(*) from wallet_holdings union all
  select 'dca_plan', count(*) from dca_plan union all
  select 'tranches', count(*) from tranches" | sed 's/|/: /'
echo "Restart the backend (./start.sh restart) to use the imported data."
