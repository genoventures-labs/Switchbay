#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${SWITCHBAY_REPO_URL:-https://github.com/genoventures-labs/Switchbay.git}"
INSTALL_ROOT="${SWITCHBAY_INSTALL_ROOT:-$HOME/.local/share/switchbay}"
SOURCE_DIR="$INSTALL_ROOT/source"
SERVICE_DIR="$HOME/.switchbay/service"
TOKEN_FILE="$HOME/.switchbay/api-token"
ENV_FILE="$HOME/.switchbay/service.env"
LOG_DIR="$HOME/.switchbay/logs"
USER_BIN="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/switchbay-api.service"
API_HOST="${SWITCHBAY_API_HOST:-127.0.0.1}"
API_PORT="${SWITCHBAY_API_PORT:-7349}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Install Switchbay on Linux Mint/Ubuntu.

Usage:
  OPENAI_API_KEY="..." ./install-linux-mint.sh

Optional environment variables:
  SWITCHBAY_REPO_URL       Git repository to clone
  SWITCHBAY_INSTALL_ROOT   Source installation root
  SWITCHBAY_API_HOST       API host (default 127.0.0.1)
  SWITCHBAY_API_PORT       API port (default 7349)
  OPENAI_API_KEY           OpenAI credential captured for the service
  ANTHROPIC_API_KEY        Anthropic credential captured for the service
  GOOGLE_API_KEY           Google credential captured for the service
EOF
  exit 0
fi

say() { printf '\n\033[1;36mSwitchbay:\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mSwitchbay install failed:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This installer is for Linux. Use 'switchbay service install' on macOS."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This installer currently targets Linux Mint/Ubuntu systems with apt."
fi

say "Installing Linux dependencies"
sudo apt-get update
sudo apt-get install -y git curl ca-certificates unzip build-essential openssl

if ! command -v bun >/dev/null 2>&1; then
  say "Installing Bun"
  curl -fsSL https://bun.sh/install | bash
fi

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$USER_BIN:/usr/local/bin:/usr/bin:/bin:$PATH"
need bun
need git
need systemctl

mkdir -p "$INSTALL_ROOT" "$SERVICE_DIR" "$LOG_DIR" "$USER_BIN" "$UNIT_DIR" "$HOME/.switchbay"

if [[ -d "$SOURCE_DIR/.git" ]]; then
  say "Updating the Switchbay checkout"
  git -C "$SOURCE_DIR" fetch origin
  git -C "$SOURCE_DIR" pull --ff-only
elif [[ -e "$SOURCE_DIR" ]]; then
  die "$SOURCE_DIR exists but is not a Git checkout. Move it aside and rerun."
else
  say "Cloning Switchbay"
  git clone "$REPO_URL" "$SOURCE_DIR"
fi

say "Installing and building Switchbay"
(
  cd "$SOURCE_DIR"
  bun install
  bun run build:client
  bun build index.tsx --target bun --outfile "$SERVICE_DIR/index.js"
  bun link
)

ln -sfn "$SOURCE_DIR/bin/switchbay" "$USER_BIN/switchbay"

if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  openssl rand -hex 32 > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

update_env() {
  local name="$1" value="${!1:-}" temporary
  [[ -n "$value" ]] || return 0
  [[ "$value" != *$'\n'* ]] || die "$name contains a newline and cannot be stored safely."
  temporary="$(mktemp)"
  grep -v "^${name}=" "$ENV_FILE" > "$temporary" || true
  printf '%s=%s\n' "$name" "$value" >> "$temporary"
  install -m 600 "$temporary" "$ENV_FILE"
  rm -f "$temporary"
}

update_env OPENAI_API_KEY
update_env ANTHROPIC_API_KEY
update_env SWITCHBAY_ANTHROPIC_MAX_TOKENS
update_env SWITCHBAY_NATIVE_TOOLS
update_env GOOGLE_API_KEY
update_env OLLAMA_API_KEY
update_env OPENROUTER_API_KEY
update_env HF_TOKEN
update_env SWITCHBAY_LMSTUDIO_API_KEY
update_env SWITCHBAY_LMSTUDIO_BASE
update_env SWITCHBAY_OLLAMA_BASE
update_env SWITCHBAY_LANE

say "Installing the systemd user service"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Switchbay local agent API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SERVICE_DIR
Environment=HOME=$HOME
Environment=PATH=$BUN_INSTALL/bin:$USER_BIN:/usr/local/bin:/usr/bin:/bin
Environment=SWITCHBAY_API_HOST=$API_HOST
Environment=SWITCHBAY_API_PORT=$API_PORT
Environment=SWITCHBAY_API_TOKEN_FILE=$TOKEN_FILE
EnvironmentFile=-$ENV_FILE
ExecStart=$BUN_INSTALL/bin/bun $SERVICE_DIR/index.js serve
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF
chmod 600 "$UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable --now switchbay-api.service
systemctl --user restart switchbay-api.service

say "Waiting for the API"
ready=0
for _ in $(seq 1 40); do
  if curl -fsS "http://$API_HOST:$API_PORT/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done

if [[ "$ready" != "1" ]]; then
  systemctl --user status switchbay-api.service --no-pager || true
  journalctl --user -u switchbay-api.service -n 50 --no-pager || true
  die "The service did not become healthy."
fi

status_code="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "authorization: Bearer $(tr -d '\n' < "$TOKEN_FILE")" \
  "http://$API_HOST:$API_PORT/v1/status")"
[[ "$status_code" == "200" ]] || die "Authenticated API check returned HTTP $status_code."

say "Installation complete"
cat <<EOF

Command:       $USER_BIN/switchbay
Source:        $SOURCE_DIR
Service:       switchbay-api.service
API:           http://$API_HOST:$API_PORT
Token:         $TOKEN_FILE
Provider env:  $ENV_FILE

Useful commands:
  switchbay
  systemctl --user status switchbay-api
  systemctl --user restart switchbay-api
  journalctl --user -u switchbay-api -f

To update later, run this installer again. It pulls Switchbay, rebuilds the
client and service snapshot, preserves your token/provider file, and restarts.

If switchbay is not found in a new terminal, add this to ~/.bashrc:
  export PATH="\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"
EOF

if [[ ! -s "$ENV_FILE" ]]; then
  printf '\nNo provider credentials were captured. Add OPENAI_API_KEY or another provider key to:\n  %s\nThen run:\n  systemctl --user restart switchbay-api\n' "$ENV_FILE"
fi
