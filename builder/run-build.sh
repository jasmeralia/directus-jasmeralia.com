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

cleanup() {
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT

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

if [[ "$GIT_AUTO_PULL" == "true" ]]; then
  if ! git -C "$ASTRO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: GIT_AUTO_PULL=true but $ASTRO_DIR is not inside a git checkout (mount the repo root, not just site/)"
    exit 2
  fi
  echo "==> Pulling latest changes for $ASTRO_DIR"
  git -C "$ASTRO_DIR" pull --ff-only
fi

mkdir -p "$BUILD_DIR"
cp -a "$ASTRO_DIR"/. "$BUILD_DIR"/

echo "==> Building Astro site from staged copy $BUILD_DIR"
cd "$BUILD_DIR"

if [[ -f package-lock.json ]]; then
  echo "==> Attempting automatic npm audit remediation"
  if npm audit fix --package-lock-only; then
    echo "==> npm audit auto-fix completed"
  else
    echo "==> npm audit auto-fix did not fully resolve all vulnerabilities; continuing"
  fi
fi

# Use npm ci when lockfile exists; fallback to npm install.
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

# Fail the build if npm audit reports any vulnerabilities.
npm audit

# Provide DIRECTUS_URL to the build if your Astro code reads it.
# Example in Astro: import.meta.env.DIRECTUS_URL (via env prefix rules) or process.env.DIRECTUS_URL.
# You may want to map this to PUBLIC_ variables depending on your Astro config.
npm run build

# Astro default output is dist/
if [[ ! -d dist ]]; then
  echo "ERROR: dist/ not found after build. Check your Astro build output."
  exit 3
fi

echo "==> Publishing dist/ to s3://$AWS_S3_BUCKET/"

# Compare SHA-256 content manifests so only byte-changed files are uploaded.
# This catches same-size edits without re-uploading unchanged generated pages.
node /srv/sync-dist.mjs \
  "$BUILD_DIR/dist" \
  "$DEPLOY_MANIFEST_PATH" \
  "$AWS_S3_BUCKET" \
  "$AWS_REGION"

if [[ "$INVALIDATE_ON_PUBLISH" == "true" ]]; then
  if [[ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "==> INVALIDATE_ON_PUBLISH=true but CLOUDFRONT_DISTRIBUTION_ID is empty; skipping invalidation."
  else
    echo "==> Creating CloudFront invalidation for /*"
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
  fi
fi

echo "==> Done"
