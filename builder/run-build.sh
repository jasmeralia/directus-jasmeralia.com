#!/usr/bin/env bash
set -euo pipefail

ASTRO_DIR="${ASTRO_DIR:-/work/site}"
GIT_AUTO_PULL="${GIT_AUTO_PULL:-false}"
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-}"
INVALIDATE_ON_PUBLISH="${INVALIDATE_ON_PUBLISH:-true}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
DEPLOY_MANIFEST_PATH="${DEPLOY_MANIFEST_PATH:-${ASTRO_DIR%/*}/.site-deploy-manifest.json}"
BUILD_ROOT="$(mktemp -d /tmp/astro-build.XXXXXX)"
BUILD_DIR="$BUILD_ROOT/site"

BUILD_START_MS=0
TIMING_STAGE=""
TIMING_STAGE_START_MS=0
TIMING_SUMMARY_PARTS=()

cleanup() {
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT

now_ms() {
  date +%s%3N
}

timing_start() {
  TIMING_STAGE="$1"
  TIMING_STAGE_START_MS="$(now_ms)"
  echo "[timing] stage_start name=${TIMING_STAGE}"
}

timing_end() {
  local end_ms
  end_ms=$(( $(now_ms) - TIMING_STAGE_START_MS ))
  echo "[timing] stage_end name=${TIMING_STAGE} duration_ms=${end_ms}"
  TIMING_SUMMARY_PARTS+=("${TIMING_STAGE}=${end_ms}")
  TIMING_STAGE=""
}

timing_summary() {
  local total_ms summary part
  total_ms=$(( $(now_ms) - BUILD_START_MS ))
  summary="[timing] summary total_ms=${total_ms}"
  for part in "${TIMING_SUMMARY_PARTS[@]}"; do
    summary+=" ${part}"
  done
  echo "$summary"
}

if [[ -z "$AWS_S3_BUCKET" ]]; then
  echo "ERROR: AWS_S3_BUCKET is not set"
  exit 2
fi
if [[ -z "$AWS_REGION" ]]; then
  echo "ERROR: AWS_REGION is not set"
  exit 2
fi
if [[ ! -d "$ASTRO_DIR" ]]; then
  echo "ERROR: ASTRO_DIR does not exist: $ASTRO_DIR"
  exit 2
fi
if [[ ! -f "$ASTRO_DIR/package.json" ]]; then
  echo "ERROR: package.json not found in ASTRO_DIR ($ASTRO_DIR). Mount your Astro project at ./site"
  exit 2
fi

BUILD_START_MS="$(now_ms)"
echo "[timing] build_start"

if [[ "$GIT_AUTO_PULL" == "true" ]]; then
  timing_start git_pull
  if ! git -C "$ASTRO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: GIT_AUTO_PULL=true but $ASTRO_DIR is not inside a git checkout (mount the repo root, not just site/)"
    exit 2
  fi
  echo "==> Pulling latest changes for $ASTRO_DIR"
  git -C "$ASTRO_DIR" pull --ff-only
  timing_end
fi

mkdir -p "$BUILD_DIR"
timing_start staging_copy
if [[ -d "$ASTRO_DIR/node_modules" ]]; then
  node_modules_mb="$(du -sm "$ASTRO_DIR/node_modules" 2>/dev/null | awk '{print $1}')"
  echo "[timing] staging_note node_modules_present=true node_modules_mb=${node_modules_mb:-unknown}"
else
  echo "[timing] staging_note node_modules_present=false"
fi
cp -a "$ASTRO_DIR"/. "$BUILD_DIR"/
timing_end

echo "==> Building Astro site from staged copy $BUILD_DIR"
cd "$BUILD_DIR"

if [[ -f package-lock.json ]]; then
  timing_start npm_audit_fix
  echo "==> Attempting automatic npm audit remediation"
  if npm audit fix --package-lock-only; then
    echo "==> npm audit auto-fix completed"
  else
    echo "==> npm audit auto-fix did not fully resolve all vulnerabilities; continuing"
  fi
  timing_end
fi

timing_start npm_ci
# Use npm ci when lockfile exists; fallback to npm install.
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
timing_end

timing_start npm_audit
# Fail the build if npm audit reports any vulnerabilities.
npm audit
timing_end

# Provide DIRECTUS_URL to the build if your Astro code reads it.
# Example in Astro: import.meta.env.DIRECTUS_URL (via env prefix rules) or process.env.DIRECTUS_URL.
# You may want to map this to PUBLIC_ variables depending on your Astro config.
timing_start astro_build
npm run build
timing_end

# Astro default output is dist/
if [[ ! -d dist ]]; then
  echo "ERROR: dist/ not found after build. Check your Astro build output."
  exit 3
fi

echo "==> Publishing dist/ to s3://$AWS_S3_BUCKET/"

# Compare SHA-256 content manifests so only byte-changed files are uploaded.
# This catches same-size edits without re-uploading unchanged generated pages.
timing_start s3_publish
node /srv/sync-dist.mjs \
  "$BUILD_DIR/dist" \
  "$DEPLOY_MANIFEST_PATH" \
  "$AWS_S3_BUCKET" \
  "$AWS_REGION"
timing_end

if [[ "$INVALIDATE_ON_PUBLISH" == "true" ]]; then
  if [[ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "==> INVALIDATE_ON_PUBLISH=true but CLOUDFRONT_DISTRIBUTION_ID is empty; skipping invalidation."
  else
    timing_start cloudfront_invalidation
    echo "==> Creating CloudFront invalidation for /*"
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
    timing_end
  fi
fi

timing_summary
echo "==> Done"
