#!/usr/bin/env bash
# Smee → localhost:3000 webhook forwarder.
#
# Reads SMEE_URL from .env at the repo root. Used both as a foreground
# process (`make smee-forward`) and as a detached background process
# (`make scheduler-up`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env ]; then
  echo "ERROR: .env not found at $REPO_ROOT" >&2
  exit 1
fi

# shellcheck disable=SC1091
. ./.env

if [ -z "${SMEE_URL:-}" ]; then
  echo "ERROR: SMEE_URL unset in .env" >&2
  exit 1
fi

# `exec` so the script process is replaced by smee-client. PID handed up
# to scheduler-up's pid file is then the live forwarder, killable directly.
exec npx --yes smee-client --url "$SMEE_URL" --target http://localhost:3000/webhooks/linear
