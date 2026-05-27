#!/usr/bin/env bash
# Build a self-contained release tarball for the Deploymate Agent.
#
# The tarball includes compiled dist/ (with path aliases rewritten by tsc-alias)
# and production-only node_modules, so the server needs no build tools.
#
# Usage:
#   bash scripts/build-release.sh
#
# Output:
#   deploymate-agent-<version>.tar.gz  (in the project root)
#
# Then upload that file somewhere accessible (your backend, S3, GitHub Releases)
# and pass its URL when running install.sh:
#   RELEASE_URL=https://... bash install.sh

set -euo pipefail

cd "$(dirname "$0")/.."   # always run from agent repo root

VERSION=$(node -p "require('./package.json').version")
ARCHIVE="$(pwd)/deploymate-agent-${VERSION}.tar.gz"
TMP_STAGE="$(mktemp -d)"

cleanup() { rm -rf "$TMP_STAGE"; }
trap cleanup EXIT

echo "[1/4] Building TypeScript (tsc + tsc-alias)..."
npm run build

echo "[2/4] Staging production dependencies..."
cp package.json package-lock.json "$TMP_STAGE/"
cp -r dist "$TMP_STAGE/"
(cd "$TMP_STAGE" && npm ci --omit=dev --ignore-scripts --quiet)

echo "[3/4] Creating tarball: $(basename "$ARCHIVE")"
tar -czf "$ARCHIVE" -C "$TMP_STAGE" .

echo "[4/4] Done."
echo ""
echo "  Archive : $ARCHIVE"
echo "  Size    : $(du -sh "$ARCHIVE" | cut -f1)"
echo ""
echo "  Upload the archive to a publicly reachable URL, then install with:"
echo "  AGENT_TOKEN=<token> BACKEND_WS_URL=wss://<host>/ws/agents RELEASE_URL=<url> bash install.sh"
