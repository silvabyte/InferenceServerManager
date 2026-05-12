#!/bin/bash
# =============================================================================
# Bitwarden vault setup for inference-server-manager
# =============================================================================
# One-time script: creates the `audetic` folder and the env items, seeding
# values from existing files where possible (CHANGE_ME placeholders otherwise).
# Idempotent — existing items are skipped.
#
#   Run: bun run secrets:init
#
# After running:  bun run secrets:local   (writes ./.env from the vault)
# Mirrors the strategy from silvabyte/weekendgarden's scripts/secrets-init.sh.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# -- Config (matches ~/dotfiles/unlock-bw.sh) ---------------------------------
PASSWORD_FILE="$HOME/.bw_password"
SESSION_FILE="$HOME/.bw_session"
SESSION_TIMEOUT=3600

# Where the systemd service reads its env file (src/cli/constants.ts).
PROD_ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/${XDG_DIR_NAME:-transcription_manager}/env"

FOLDER_NAME="audetic"
LOCAL_ITEM="audetic/ism-env-local"
PROD_ITEM="audetic/ism-env-prod"

# -- Colors --------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# -- Preflight -----------------------------------------------------------------
for cmd in bw jq; do
  command -v "$cmd" &>/dev/null || { error "$cmd is required but not installed"; exit 1; }
done

# -- Session management (from ~/dotfiles/unlock-bw.sh) ------------------------
is_session_valid() {
  [[ -f "$SESSION_FILE" ]] || return 1
  local file_age=$(( $(date +%s) - $(stat -c %Y "$SESSION_FILE") ))
  (( file_age <= SESSION_TIMEOUT )) || { rm -f "$SESSION_FILE"; return 1; }
  local session
  session=$(cat "$SESSION_FILE")
  BW_SESSION="$session" bw unlock --check &>/dev/null || { rm -f "$SESSION_FILE"; return 1; }
  export BW_SESSION="$session"
}

ensure_unlocked() {
  if is_session_valid; then return 0; fi
  [[ -f "$PASSWORD_FILE" ]] || { error "Password file not found: $PASSWORD_FILE"; exit 1; }
  info "Unlocking Bitwarden..."
  local session_key
  session_key=$(bw unlock --passwordfile "$PASSWORD_FILE" --raw 2>&1) || { error "Failed to unlock"; exit 1; }
  export BW_SESSION="$session_key"
  echo "$session_key" > "$SESSION_FILE"
  chmod 600 "$SESSION_FILE"
  success "Vault unlocked"
}

# -- Helpers -------------------------------------------------------------------
# Echo `KEY=value` lines from a .env-style file (skips comments / blanks).
read_env_pairs() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" || true
}

# Create a secure note with custom fields. Args after folder id are KEY=value.
create_secure_note() {
  local name="$1" folder_id="$2"; shift 2
  local fields="[]"
  for pair in "$@"; do
    local fname="${pair%%=*}" fval="${pair#*=}"
    fields=$(echo "$fields" | jq --arg n "$fname" --arg v "$fval" '. + [{"name": $n, "value": $v, "type": 0}]')
  done
  local item_json
  item_json=$(bw get template item | jq \
    --arg name "$name" --arg fid "$folder_id" --argjson fields "$fields" \
    '.type = 2 | .name = $name | .folderId = $fid | .secureNote = {"type": 0} | .fields = $fields | .notes = ""')
  local result
  result=$(echo "$item_json" | bw encode | bw create item 2>&1) || { error "Failed to create '$name': $result"; return 1; }
  success "Created: $name ($(echo "$result" | jq -r '.id'))" >&2
}

# ==============================================================================
main() {
  ensure_unlocked
  bw sync --session "$BW_SESSION" > /dev/null 2>&1
  success "Vault synced"

  # -- Folder ------------------------------------------------------------------
  local folder_id
  folder_id=$(bw list folders --search "$FOLDER_NAME" 2>/dev/null | jq -r --arg n "$FOLDER_NAME" '.[] | select(.name == $n) | .id' | head -1)
  if [[ -n "$folder_id" ]]; then
    warn "Folder '$FOLDER_NAME' already exists ($folder_id), reusing"
  else
    folder_id=$(bw get template folder | jq --arg n "$FOLDER_NAME" '.name = $n' | bw encode | bw create folder | jq -r '.id')
    success "Created folder: $FOLDER_NAME ($folder_id)"
  fi

  local existing_items
  existing_items=$(bw list items --folderid "$folder_id" 2>/dev/null | jq -r '.[].name' 2>/dev/null || echo "")
  check_exists() { echo "$existing_items" | grep -qF "$1"; }

  # -- audetic/ism-env-local ---------------------------------------------------
  if check_exists "$LOCAL_ITEM"; then
    warn "$LOCAL_ITEM already exists, skipping"
  else
    info "Creating $LOCAL_ITEM (seeding from $REPO_ROOT/.env)..."
    local local_pairs
    mapfile -t local_pairs < <(read_env_pairs "$REPO_ROOT/.env")
    if [[ ${#local_pairs[@]} -eq 0 ]]; then
      warn "No ./.env found — seeding placeholders"
      local_pairs=(
        "WHISPER_SERVER_CMD=CHANGE_ME"
        "WHISPER_SERVER_CWD=CHANGE_ME"
        "LOG_LEVEL=info"
        "AXIOM_TOKEN=CHANGE_ME"
        "AXIOM_LOGS_DATASET=audetic-ism-logs"
        "AXIOM_METRICS_DATASET=audetic-ism-metrics"
      )
    fi
    create_secure_note "$LOCAL_ITEM" "$folder_id" "${local_pairs[@]}"
  fi

  # -- audetic/ism-env-prod ----------------------------------------------------
  if check_exists "$PROD_ITEM"; then
    warn "$PROD_ITEM already exists, skipping"
  else
    info "Creating $PROD_ITEM..."
    local prod_pairs
    mapfile -t prod_pairs < <(read_env_pairs "$PROD_ENV_FILE")
    if [[ ${#prod_pairs[@]} -eq 0 ]]; then
      warn "No $PROD_ENV_FILE found — seeding placeholders"
      prod_pairs=(
        "WHISPER_SERVER_CMD=CHANGE_ME"
        "INFERENCE_SERVER_PORT=3141"
        "INFERENCE_SERVER_HOST=0.0.0.0"
        "LOG_LEVEL=info"
        "AXIOM_TOKEN=CHANGE_ME"
        "AXIOM_LOGS_DATASET=audetic-ism-logs"
        "AXIOM_METRICS_DATASET=audetic-ism-metrics"
      )
    fi
    create_secure_note "$PROD_ITEM" "$folder_id" "${prod_pairs[@]}"
  fi

  echo ""
  echo -e "${GREEN}=== Vault setup complete ===${NC}"
  echo ""
  echo "Items in the '$FOLDER_NAME' folder:"
  echo "  - $LOCAL_ITEM   (seeded from ./.env)"
  echo "  - $PROD_ITEM    (seeded from $PROD_ENV_FILE)"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "  1. Edit any CHANGE_ME placeholders in Bitwarden (e.g. $PROD_ITEM → AXIOM_TOKEN, WHISPER_SERVER_CMD)."
  echo "  2. Pull locally:  bun run secrets:local"
  echo "  3. On the server: bun run secrets:prod   (writes $PROD_ENV_FILE), then restart the service."
}

main "$@"
