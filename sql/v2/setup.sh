#!/usr/bin/env bash
# Run the Seat Sweeper V2 lab setup against one account.
#   sql/v2/setup.sh <connection> [names-file]
# names-file defaults to names.default.env (attendee accounts).
# Maintainers can supply an explicit isolated rehearsal names file.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
connection="${1:?usage: setup.sh <connection> [names-file]}"
names="${2:-$here/names.default.env}"

vars=()
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  [[ "$value" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Invalid identifier for $key: $value" >&2; exit 1; }
  vars+=(-D "$key=$value")
done < "$names"

echo "Account check:"
snow sql --connection "$connection" -q "SELECT CURRENT_ACCOUNT_NAME() AS account, CURRENT_USER() AS user_name, CURRENT_ROLE() AS role"
snow sql --connection "$connection" --role ACCOUNTADMIN "${vars[@]}" \
  -f "$here/00_setup.sql" -f "$here/01_seed.sql"

# Stage the real documents now; the attendee builds parsing in the pipeline segment.
python3 "$here/../../scripts/contract_pipeline.py" landing --connection "$connection" --names "$names"
python3 "$here/../../scripts/contract_pipeline.py" stage --connection "$connection" --names "$names" --group baseline
