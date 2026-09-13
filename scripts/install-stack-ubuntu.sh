#!/usr/bin/env bash
# Installs / upgrades the full gold-cockpit technology stack on an Ubuntu
# server, matching (or exceeding) the versions recorded on the reference
# dev machine (see stack-versions.txt / print-stack-versions.sh).
#
# For every tool: if it's missing -> install it. If it's older than the
# target version below -> upgrade it. If it's already >= target -> leave
# it alone.
#
# Tested against: Ubuntu 24.04 "noble" (kernel 6.8.x). Run as root or with
# sudo available.
#
# Usage:
#   sudo ./scripts/install-stack-ubuntu.sh
#   sudo ./scripts/install-stack-ubuntu.sh --with-flutter   # also installs Flutter/Dart
#   sudo ./scripts/install-stack-ubuntu.sh --project-deps /path/to/gold-cockpit  # also runs npm ci there
#
# Re-run any time — it's idempotent.

set -euo pipefail

# ---------------------------------------------------------------------------
# Target versions — taken from stack-versions.txt (reference: macOS dev box)
# ---------------------------------------------------------------------------
TARGET_NODE="24.14.1"
TARGET_NPM="11.11.0"
TARGET_GIT="2.50.1"
TARGET_PSQL="16.0"        # production DB is postgres:16-alpine (docker-compose.yml); local psql on the Mac (15.18) is dev-only, so we target 16.
TARGET_DOCKER="29.4.3"
TARGET_FLUTTER="3.44.7"
TARGET_DART="3.12.2"

WITH_FLUTTER=0
PROJECT_DEPS_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --with-flutter) WITH_FLUTTER=1; shift ;;
    --project-deps) PROJECT_DEPS_DIR="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[1;32m✓ %s\033[0m\n' "$1"; }
warn() { printf '    \033[1;33m! %s\033[0m\n' "$1"; }

# version_ge A B  -> true (0) if A >= B
version_ge() {
  [ "$1" = "$2" ] && return 0
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

apt_update_once() {
  if [ -z "${APT_UPDATED:-}" ]; then
    log "Updating apt package index"
    $SUDO apt-get update -y
    export APT_UPDATED=1
  fi
}

# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------
install_git() {
  log "git (target >= $TARGET_GIT)"
  local current="0.0.0"
  if command -v git >/dev/null 2>&1; then
    current="$(git --version | awk '{print $3}')"
  fi
  if version_ge "$current" "$TARGET_GIT"; then
    ok "git $current already satisfies >= $TARGET_GIT"
    return
  fi
  warn "git $current < $TARGET_GIT — upgrading via git-core PPA"
  apt_update_once
  $SUDO apt-get install -y software-properties-common
  $SUDO add-apt-repository -y ppa:git-core/ppa
  $SUDO apt-get update -y
  $SUDO apt-get install -y git
  ok "git now $(git --version | awk '{print $3}')"
}

# ---------------------------------------------------------------------------
# Node.js + npm (via NodeSource, major version 24 to match target)
# ---------------------------------------------------------------------------
install_node() {
  log "Node.js (target >= $TARGET_NODE) / npm (target >= $TARGET_NPM)"
  local current_node="0.0.0"
  if command -v node >/dev/null 2>&1; then
    current_node="$(node -v | sed 's/^v//')"
  fi
  local target_major="${TARGET_NODE%%.*}"
  local current_major="${current_node%%.*}"
  if version_ge "$current_node" "$TARGET_NODE"; then
    ok "node $current_node already satisfies >= $TARGET_NODE"
  else
    warn "node $current_node < $TARGET_NODE — installing Node ${target_major}.x from NodeSource"
    apt_update_once
    $SUDO apt-get install -y ca-certificates curl gnupg
    curl -fsSL "https://deb.nodesource.com/setup_${target_major}.x" | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
    ok "node now $(node -v)"
  fi

  local current_npm
  current_npm="$(npm -v)"
  if version_ge "$current_npm" "$TARGET_NPM"; then
    ok "npm $current_npm already satisfies >= $TARGET_NPM"
  else
    warn "npm $current_npm < $TARGET_NPM — upgrading global npm"
    $SUDO npm install -g npm@latest
    ok "npm now $(npm -v)"
  fi
}

# ---------------------------------------------------------------------------
# PostgreSQL client (matches postgres:16-alpine used in docker-compose.yml)
# ---------------------------------------------------------------------------
install_postgres_client() {
  log "PostgreSQL client (target >= $TARGET_PSQL, matches production's postgres:16-alpine)"
  local current="0.0.0"
  if command -v psql >/dev/null 2>&1; then
    current="$(psql --version | awk '{print $3}')"
  fi
  if version_ge "$current" "$TARGET_PSQL"; then
    ok "psql $current already satisfies >= $TARGET_PSQL"
    return
  fi
  warn "psql $current < $TARGET_PSQL — installing from the official PostgreSQL (PGDG) apt repo"
  apt_update_once
  $SUDO apt-get install -y curl ca-certificates gnupg lsb-release
  $SUDO install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
    $SUDO gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
  local codename
  codename="$(lsb_release -cs)"
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" | \
    $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y postgresql-client-16
  ok "psql now $(psql --version | awk '{print $3}')"
}

# ---------------------------------------------------------------------------
# Docker Engine + Compose plugin (official Docker apt repo)
# ---------------------------------------------------------------------------
install_docker() {
  log "Docker (target >= $TARGET_DOCKER)"
  local current="0.0.0"
  if command -v docker >/dev/null 2>&1; then
    current="$(docker --version | sed -E 's/Docker version ([0-9.]+),.*/\1/')"
  fi
  if version_ge "$current" "$TARGET_DOCKER"; then
    ok "docker $current already satisfies >= $TARGET_DOCKER"
    return
  fi
  warn "docker $current < $TARGET_DOCKER (or missing) — installing latest from Docker's official apt repo"
  apt_update_once
  $SUDO apt-get install -y ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  local codename arch
  codename="$(lsb_release -cs)"
  arch="$(dpkg --print-architecture)"
  echo \
    "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
  if [ -n "${SUDO_USER:-}" ]; then
    $SUDO usermod -aG docker "$SUDO_USER" || true
    warn "added $SUDO_USER to the docker group — log out/in for it to take effect"
  fi
  ok "docker now $(docker --version)"
}

# ---------------------------------------------------------------------------
# Flutter + Dart (optional — only needed to build flutter_app on this host)
# ---------------------------------------------------------------------------
install_flutter() {
  log "Flutter (target >= $TARGET_FLUTTER) / Dart (target >= $TARGET_DART)"
  local current="0.0.0"
  if command -v flutter >/dev/null 2>&1; then
    current="$(flutter --version 2>/dev/null | head -1 | awk '{print $2}')"
  fi
  if version_ge "$current" "$TARGET_FLUTTER"; then
    ok "flutter $current already satisfies >= $TARGET_FLUTTER"
    return
  fi
  warn "flutter $current < $TARGET_FLUTTER (or missing) — installing stable $TARGET_FLUTTER"
  apt_update_once
  $SUDO apt-get install -y curl git unzip xz-utils zip libglu1-mesa
  local install_dir="/opt/flutter"
  if [ -d "$install_dir" ]; then
    warn "removing existing $install_dir to reinstall clean"
    $SUDO rm -rf "$install_dir"
  fi
  $SUDO git clone --branch "$TARGET_FLUTTER" --depth 1 https://github.com/flutter/flutter.git "$install_dir"
  $SUDO chown -R "$(id -un)":"$(id -gn)" "$install_dir" || true
  if ! grep -q '/opt/flutter/bin' /etc/profile.d/flutter.sh 2>/dev/null; then
    echo 'export PATH="$PATH:/opt/flutter/bin"' | $SUDO tee /etc/profile.d/flutter.sh >/dev/null
  fi
  export PATH="$PATH:/opt/flutter/bin"
  flutter --version
  ok "flutter installed at $install_dir (open a new shell, or 'source /etc/profile.d/flutter.sh', to pick up PATH)"
}

# ---------------------------------------------------------------------------
# Project npm dependencies (exact versions from package-lock.json)
# ---------------------------------------------------------------------------
install_project_deps() {
  local dir="$1"
  log "Project npm dependencies in $dir (npm ci — exact versions from package-lock.json)"
  if [ ! -f "$dir/package-lock.json" ]; then
    warn "$dir/package-lock.json not found — skipping. Clone the repo (and its sibling AI_settings_card dep, see Dockerfile) first."
    return
  fi
  (cd "$dir" && npm ci)
  ok "project dependencies installed (express, preact, pg, vite, vitest, typescript, tailwindcss, supertest, ai-settings-ui, ...)"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "Target host: $(uname -a)"

apt_update_once
install_git
install_node
install_postgres_client
install_docker

if [ "$WITH_FLUTTER" -eq 1 ]; then
  install_flutter
else
  warn "Skipping Flutter/Dart (only needed to build flutter_app on this host). Pass --with-flutter to install."
fi

if [ -n "$PROJECT_DEPS_DIR" ]; then
  install_project_deps "$PROJECT_DEPS_DIR"
else
  warn "Skipping project npm deps (pass --project-deps /path/to/gold-cockpit once the repo is cloned)"
fi

log "Done. Installed / verified versions:"
command -v git    >/dev/null && echo "  git:    $(git --version)"
command -v node   >/dev/null && echo "  node:   $(node -v)"
command -v npm    >/dev/null && echo "  npm:    $(npm -v)"
command -v psql   >/dev/null && echo "  psql:   $(psql --version)"
command -v docker >/dev/null && echo "  docker: $(docker --version)"
command -v flutter>/dev/null && echo "  flutter: $(flutter --version 2>/dev/null | head -1)"
