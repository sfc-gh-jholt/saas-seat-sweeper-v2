#!/usr/bin/env bash
# Run the Seat Sweeper V2 lab setup against one account from a laptop.
#   sql/v2/setup.sh <connection> [names-file]
# names-file defaults to names.default.env (attendee accounts).
# Maintainers can supply an explicit isolated rehearsal names file.
# The steps live in scripts/lab_setup.py, which a Snowsight notebook runs directly.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
connection="${1:?usage: setup.sh <connection> [names-file]}"
names="${2:-$here/names.default.env}"

PYTHON_BIN="$here/../../.venv/bin/python"
if [ ! -f "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

exec "$PYTHON_BIN" "$here/../../scripts/lab_setup.py" --connection "$connection" --names "$names"
