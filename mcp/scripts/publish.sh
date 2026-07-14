#!/usr/bin/env bash
# Usage: publish.sh --title "fix: something" [--body "PR body"] [--no-build]
#
# Pushes the current branch, opens a PR, squash-merges it, pulls on TrueNAS,
# and triggers a site rebuild via the Directus flow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_JSON="$REPO_ROOT/.mcp.json"
TRUENAS="morgan@truenas.windsofstorm.net"
TRUENAS_REPO="/mnt/myzmirror/directus-jasmeralia"

TITLE=""
BODY=""
NO_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)    TITLE="$2"; shift 2 ;;
    --body)     BODY="$2";  shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    *) echo "Unknown option: $1" >&2
       echo "Usage: $(basename "$0") --title <title> [--body <body>] [--no-build]" >&2
       exit 1 ;;
  esac
done

[[ -z "$TITLE" ]] && { echo "Error: --title is required." >&2; exit 1; }

cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "master" ]] && {
  echo "Error: already on master — create a feature branch first." >&2
  exit 1
}

echo "==> Pushing $BRANCH..."
git push -u origin "$BRANCH"

echo "==> Creating PR..."
PR_URL="$(gh pr create --title "$TITLE" --body "${BODY:-}" | tail -1)"
echo "    $PR_URL"

echo "==> Merging PR..."
gh pr merge --squash --delete-branch

echo "==> Updating local master..."
git checkout master
git pull origin master

echo "==> Pulling on TrueNAS..."
# shellcheck disable=SC2029 # TRUENAS_REPO is a fixed script constant, not user input; client-side expansion is intended.
if ! ssh "$TRUENAS" "git -C $TRUENAS_REPO pull" 2>&1; then
  echo "    Retrying after cleaning untracked files..."
  # shellcheck disable=SC2029 # same rationale as above.
  ssh "$TRUENAS" "git -C $TRUENAS_REPO clean -f .serena/ && git -C $TRUENAS_REPO pull"
fi

if [[ $NO_BUILD -eq 1 ]]; then
  echo "==> Skipping build (--no-build)."
  exit 0
fi

echo "==> Triggering rebuild..."
TOKEN="$(python3 -c "import json; d=json.load(open('$MCP_JSON')); print(d['mcpServers']['directus']['env']['DIRECTUS_TOKEN'])")"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  'https://directus.jasmer.tools/flows/trigger/e3aa03ad-3352-4ade-8156-22d53f107907' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"collection":"games","keys":["448"]}')"
echo "    HTTP $STATUS"
[[ "$STATUS" == "204" ]] || echo "    Warning: expected 204." >&2
