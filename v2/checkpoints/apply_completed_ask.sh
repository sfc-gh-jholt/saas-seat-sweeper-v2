#!/usr/bin/env bash
# Apply the completed Ask integration (v2 checkpoint) to your starter app.
#   v2/checkpoints/apply_completed_ask.sh [app-dir]          # preview only
#   v2/checkpoints/apply_completed_ask.sh [app-dir] --apply  # copy files
# Overwrites only the listed integration files; manifests, dependencies and dashboard are untouched.
# Markdown dependencies are prepared in the starter before the exercise.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/completed-ask"
app="${1:-$here/../starter-app}"
files=(lib/agent.ts lib/agent-stream.ts components/agent-answer.tsx app/api/ask/route.ts app/ask/page.tsx __tests__/api/ask.test.ts __tests__/lib/agent.test.ts __tests__/lib/agent-stream.test.ts __tests__/components/agent-answer.test.tsx)

[[ -f "$app/app.yml" ]] || { echo "Not an app directory: $app" >&2; exit 1; }
# Validate the full overlay before copying any files.
for f in "${files[@]}"; do
  [[ -f "$src/$f" && ! -L "$app/$f" ]] || { echo "Missing source or unsafe target: $f" >&2; exit 1; }
done
for f in "${files[@]}"; do
  if [[ -e "$app/$f" ]] && ! cmp -s "$src/$f" "$app/$f"; then echo "replace  $f"; elif [[ -e "$app/$f" ]]; then echo "same     $f"; else echo "add      $f"; fi
done
if [[ "${2:-}" != "--apply" ]]; then echo "Preview only. Re-run with --apply to copy."; exit 0; fi
for f in "${files[@]}"; do mkdir -p "$app/$(dirname "$f")"; cp "$src/$f" "$app/$f"; done
echo "Applied. Now run: npx tsc --noEmit && npm test && npm run build"
