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

# Postgres system of record. Each step is idempotent; KEY=VALUE lines on stdout become -D vars.
pg="$here/../../scripts/pg_setup.py"
pg_instance=SEAT_SWEEPER_PG
pg_service=seat_sweeper_pg   # pg_connect.py names the service after the lowercased instance
lab_db=$(grep '^lab_db=' "$names" | cut -d= -f2)
lab_role=$(grep '^lab_role=' "$names" | cut -d= -f2)

python3 "$pg" instance --connection "$connection" --instance "$pg_instance" >/dev/null
pg_vars=(-D "pg_instance=$pg_instance")
while IFS= read -r line; do pg_vars+=(-D "$line"); done < <(python3 "$pg" access-vars --connection "$connection" --instance "$pg_instance")
snow sql --connection "$connection" --role ACCOUNTADMIN "${vars[@]}" "${pg_vars[@]}" -f "$here/06_app_postgres_access.sql"

python3 "$pg" seed --service "$pg_service"
python3 "$pg" app-login --service "$pg_service"
python3 "$pg" secret --connection "$connection" --service "$pg_service" --db "$lab_db" --role "$lab_role"

mirror_line=$(python3 "$pg" mirror --connection "$connection" --instance "$pg_instance")
snow sql --connection "$connection" --role ACCOUNTADMIN "${vars[@]}" -D "$mirror_line" -f "$here/05_ops_views.sql"
echo "Setup complete. Postgres mirror: ${mirror_line#mirror_db=}. Suspend the instance when idle:"
echo "  ALTER POSTGRES INSTANCE $pg_instance SUSPEND;"
