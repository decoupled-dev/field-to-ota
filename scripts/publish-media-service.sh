#!/usr/bin/env bash
# Push the media-service release history (v2.2.9, v2.3.1) to the GitHub repo in GITHUB_REPO, so the
# Fix agent's pull requests have a real base. Run once after the console has started (it builds the history).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${GITHUB_REPO:?set GITHUB_REPO=owner/name}" "${GITHUB_TOKEN:?set GITHUB_TOKEN}"
git -C .state/workspace/remote/media-service.git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" main --tags
