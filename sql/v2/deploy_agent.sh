#!/usr/bin/env bash
# Deploy the template to a fresh lab; pass --update for an existing lab/rehearsal agent.
# deploy_agent.sh <connection> [names-file] [--update]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
connection="${1:?usage: deploy_agent.sh <connection> [names-file] [--update]}"
names="${2:-$here/names.default.env}"
args=(--connection "$connection" --names "$names")
if [[ "${3:-}" == "--update" ]]; then args+=(--update); fi
python3 "$here/../../scripts/deploy_lab_agent.py" "${args[@]}"
