#!/usr/bin/env bash
# PreToolUse guard for Bash/Monitor commands that query the TrueNAS OpenSearch
# instance for directus-site-builder build-completion status.
#
# This exists because the exact same handful of query bugs (wrong index,
# ascending sort + size cap, a server-side wildcard clause that silently
# matches nothing, wrong field names) has been independently reintroduced
# across multiple sessions despite being documented in AGENTS.md and in this
# project's auto-memory (feedback_build_monitor.md, reference_opensearch.md).
# See those files for the full incident history.
set -euo pipefail

input=$(cat)
tool_name=$(jq -r '.tool_name // empty' <<<"$input")
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")

# Only look at Bash/Monitor calls.
if [[ "$tool_name" != "Bash" && "$tool_name" != "Monitor" ]]; then
  exit 0
fi

# Only activate for commands clearly targeting this specific build-log query.
if [[ "$cmd" != *"truenas.windsofstorm.net:9200"* ]]; then
  exit 0
fi
if [[ "$cmd" != *"container-logs"* && "$cmd" != *"container_name"* ]]; then
  exit 0
fi

reasons=()

# 1. Wrong / stale index.
if [[ "$cmd" == *"/container-logs/_search"* ]]; then
  reasons+=("Queries the stale, orphaned plain 'container-logs' index instead of the 'container-logs-write' rollover alias. It returns near-empty results without erroring, which looks exactly like broken log shipping but isn't.")
fi
if [[ "$cmd" == *"logstash"* ]]; then
  reasons+=("References a 'logstash-*' index pattern, which is wrong for this repo's build logs.")
fi

# 2. Ascending sort on @timestamp (misses the completion line once a build
#    exceeds the query's size cap -- builds run from ~80 to 4000+ lines).
if [[ ( "$cmd" == *'"order":"asc"'* || "$cmd" == *'"order": "asc"'* ) && "$cmd" == *"@timestamp"* ]]; then
  reasons+=("Sorts @timestamp ascending. Combined with any fixed size cap this misses the completion line on longer builds. Always sort descending and check only the newest hits.")
fi

# 3. Server-side wildcard clause on the log field (confirmed to silently
#    match zero hits for patterns containing '/', e.g. 'Build/publish').
if [[ "$cmd" == *'"wildcard"'* && "$cmd" == *'"log"'* ]]; then
  reasons+=("Uses a server-side 'wildcard' query clause on the 'log' field to filter for the completion line. Confirmed to silently return zero hits even when the line exists and is indexed -- the field's analysis doesn't reliably match a literal substring wildcard containing '/'. Filter client-side (grep/python over the returned log values) after a plain term query on container_name.keyword instead.")
fi

# 4. Wrong field names.
if [[ "$cmd" == *"container.name"* ]]; then
  reasons+=("References 'container.name' instead of the correct field 'container_name.keyword'.")
fi
if [[ "$cmd" == *'"message"'* && "$cmd" != *'"log"'* ]]; then
  reasons+=("Appears to query the 'message' field instead of the correct field 'log'.")
fi

if [[ ${#reasons[@]} -eq 0 ]]; then
  exit 0
fi

bullet_list=$(printf -- '- %s\n' "${reasons[@]}")
reason_text="Blocked: this command targets the TrueNAS directus-site-builder OpenSearch build-log query, but matches a bug pattern that has caused SILENT build-monitoring failures in this repo before (confirmed across multiple sessions):

${bullet_list}
Use the canonical query instead (from AGENTS.md 'Checking build logs' / the reference_opensearch memory):

curl -s \"http://truenas.windsofstorm.net:9200/container-logs-write/_search\" -H \"Content-Type: application/json\" -d '{\"size\":30,\"query\":{\"term\":{\"container_name.keyword\":\"directus-site-builder\"}},\"sort\":[{\"@timestamp\":{\"order\":\"desc\"}}],\"_source\":[\"@timestamp\",\"log\"]}' | python3 -c \"import json,sys; [print(h['_source']['@timestamp'][:19], h['_source']['log'].rstrip()) for h in reversed(json.load(sys.stdin)['hits']['hits'])]\"

Then filter client-side (grep/python) for the exact strings 'Build/publish completed successfully.' or 'Build/publish FAILED' -- never a vague substring like 'complete'."

jq -n --arg reason "$reason_text" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
