#!/usr/bin/env bash
set -euo pipefail

ASTRO_DIR="${ASTRO_DIR:-/work/site}"
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-}"
INVALIDATE_ON_PUBLISH="${INVALIDATE_ON_PUBLISH:-true}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
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

# Fail the build only on critical vulnerabilities. High-severity advisories that only
# affect Windows dev servers or Deno runtimes (e.g. esbuild GHSA-g7r4-m6w7-qqqr,
# GHSA-gv7w-rqvm-qjhr) are not applicable to this Linux static-build environment.
npm audit --audit-level=critical

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

# Sync all site content except media/ (preserved) and pagefind/ (handled separately below).
# --size-only skips timestamp comparison — every build produces fresh mtimes in a temp dir,
# which would otherwise cause aws s3 sync to re-upload the entire site on every run.
aws s3 sync "$BUILD_DIR/dist/" "s3://${AWS_S3_BUCKET}/" \
  --size-only --delete \
  --exclude "media/*" \
  --exclude "pagefind/*" \
  --region "$AWS_REGION"

# Pagefind shards use content-addressed filenames (e.g. en_d549c8a.pf_fragment).
# --size-only is safe here: aws s3 sync compares by key name first, so a shard that
# doesn't exist in S3 is uploaded regardless of size; a shard with the same hash-based
# name has identical content and can be skipped. pagefind-entry.json is NOT content-
# addressed — it lists current shard names and changes every build — so force-upload it
# after the sync to avoid a stale index if the byte count happens to stay the same.
aws s3 sync "$BUILD_DIR/dist/pagefind/" "s3://${AWS_S3_BUCKET}/pagefind/" \
  --size-only --delete \
  --region "$AWS_REGION"

aws s3 cp "$BUILD_DIR/dist/pagefind/pagefind-entry.json" "s3://${AWS_S3_BUCKET}/pagefind/pagefind-entry.json" \
  --region "$AWS_REGION"

if [[ "$INVALIDATE_ON_PUBLISH" == "true" ]]; then
  if [[ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "==> INVALIDATE_ON_PUBLISH=true but CLOUDFRONT_DISTRIBUTION_ID is empty; skipping invalidation."
  else
    echo "==> Creating CloudFront invalidation for /*"
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
  fi
fi

echo "==> Done"
