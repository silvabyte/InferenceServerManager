#!/usr/bin/env bash
set -euo pipefail

# Provision the Axiom datasets used by inference-server-manager and print the
# env vars the service needs. Idempotent — re-running is safe (dataset creation
# just no-ops if the dataset already exists).
#
# Requires the `axiom` CLI, authenticated (`axiom auth login`).
#
# Usage:
#   scripts/axiom-setup.sh [--deployment <name>] [--prefix <name>]
#
# Defaults: deployment = whatever the CLI has active; prefix = "audetic-ism".

CYAN=$'\033[0;36m'; GREEN=$'\033[0;32m'; BOLD=$'\033[1m'; NC=$'\033[0m'

DEPLOYMENT=""
PREFIX="audetic-ism"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployment) DEPLOYMENT="$2"; shift 2 ;;
    --deployment=*) DEPLOYMENT="${1#*=}"; shift ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    -h|--help) sed -n '3,14p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v axiom >/dev/null || { echo "axiom CLI not found — install it and run 'axiom auth login'" >&2; exit 1; }

DEP_FLAG=()
[[ -n "$DEPLOYMENT" ]] && DEP_FLAG=(-D "$DEPLOYMENT")

LOGS_DS="${PREFIX}-logs"
METRICS_DS="${PREFIX}-metrics"

create() {
  local name="$1" desc="$2"
  if axiom dataset list "${DEP_FLAG[@]}" --no-spinner 2>/dev/null | awk '{print $1}' | grep -qx "$name"; then
    echo -e "  ${GREEN}✓${NC} dataset '$name' already exists"
  else
    axiom dataset create "${DEP_FLAG[@]}" --no-spinner --name "$name" --description "$desc"
    echo -e "  ${GREEN}✓${NC} created dataset '$name'"
  fi
}

echo -e "${CYAN}${BOLD}Provisioning Axiom datasets${NC}"
create "$LOGS_DS"    "Logs from inference-server-manager (voice.audetic.link)"
create "$METRICS_DS" "OpenTelemetry metrics from inference-server-manager (voice.audetic.link)"

cat <<EOF

${BOLD}Next steps${NC}
  1. Create an Axiom API token (Settings → API tokens) with ingest access to
     '$LOGS_DS' and '$METRICS_DS'. A personal token also works if you also set
     AXIOM_ORG_ID.
  2. Add to the service env file (~/.config/transcription_manager/env):

       AXIOM_TOKEN=xaat-...
       AXIOM_LOGS_DATASET=$LOGS_DS
       AXIOM_METRICS_DATASET=$METRICS_DS
       # AXIOM_ORG_ID=...           # only if AXIOM_TOKEN is a personal (xapt-) token
       # AXIOM_URL=https://api.eu.axiom.co   # only for the EU region

  3. Restart: systemctl --user restart inference-server-manager
EOF
