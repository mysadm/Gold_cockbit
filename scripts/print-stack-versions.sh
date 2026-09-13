#!/usr/bin/env bash
# Captures the resolved versions of every tool/library in the gold-cockpit
# stack and writes them to a report file (default: stack-versions.txt).
#
# Usage: ./scripts/print-stack-versions.sh [output-file]

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="${1:-$ROOT_DIR/stack-versions.txt}"

cd "$ROOT_DIR"

have() { command -v "$1" >/dev/null 2>&1; }

node_lockfile_version() {
  # $1 = node_modules/<pkg> key as it appears in package-lock.json
  node -e "
    try {
      const lock = require('./package-lock.json');
      const p = (lock.packages || {})['$1'];
      console.log(p ? p.version : 'not found');
    } catch (e) { console.log('package-lock.json not found'); }
  " 2>/dev/null || echo "n/a"
}

{
  echo "Gold Cockpit — Technology Stack Versions"
  echo "Generated: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "=========================================="
  echo

  echo "## System tools"
  have node    && echo "node:        $(node -v)"            || echo "node:        not installed"
  have npm     && echo "npm:         $(npm -v)"             || echo "npm:         not installed"
  have git     && echo "git:         $(git --version)"      || echo "git:         not installed"
  have psql    && echo "psql:        $(psql --version)"     || echo "psql:        not installed"
  have docker  && echo "docker:      $(docker --version)"   || echo "docker:      not installed"
  have flutter && echo "flutter:     $(flutter --version 2>/dev/null | head -1)" || echo "flutter:     not installed"
  have dart    && echo "dart:        $(dart --version 2>&1)" || true
  echo

  echo "## Node/npm packages (resolved from package-lock.json)"
  if [ -f package-lock.json ]; then
    echo "express:                 $(node_lockfile_version node_modules/express)"
    echo "preact:                  $(node_lockfile_version node_modules/preact)"
    echo "pg:                      $(node_lockfile_version node_modules/pg)"
    echo "dotenv:                  $(node_lockfile_version node_modules/dotenv)"
    echo "vite:                    $(node_lockfile_version node_modules/vite)"
    echo "vitest:                  $(node_lockfile_version node_modules/vitest)"
    echo "typescript:              $(node_lockfile_version node_modules/typescript)"
    echo "tailwindcss:             $(node_lockfile_version node_modules/tailwindcss)"
    echo "@tailwindcss/vite:       $(node_lockfile_version node_modules/@tailwindcss/vite)"
    echo "@preact/preset-vite:     $(node_lockfile_version node_modules/@preact/preset-vite)"
    echo "supertest:               $(node_lockfile_version node_modules/supertest)"
    echo "ai-settings-ui (local):  $(node -e "try{console.log(require('./node_modules/ai-settings-ui/package.json').version)}catch(e){console.log('not installed')}" 2>/dev/null)"
  else
    echo "package-lock.json not found — run 'npm install' first."
  fi
  echo

  echo "## Docker / database (from Dockerfile & docker-compose.yml)"
  [ -f Dockerfile ] && grep -m1 '^FROM' Dockerfile | sed 's/^/base image: /' || echo "Dockerfile not found"
  [ -f docker-compose.yml ] && grep -m1 'image: postgres' docker-compose.yml | sed 's/^ *image:/postgres image:/' || true
  echo

  echo "## Flutter app (flutter_app/pubspec.yaml)"
  if [ -f flutter_app/pubspec.yaml ]; then
    grep -E '^  sdk:|^  flutter_riverpod:|^  dio:|^  flutter_secure_storage:|^  shared_preferences:|^  intl:|^  cupertino_icons:|^  google_fonts:' flutter_app/pubspec.yaml
  else
    echo "flutter_app/pubspec.yaml not found"
  fi
} | tee "$OUT_FILE"

echo
echo "Report written to: $OUT_FILE"
