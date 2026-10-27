#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
test -f runtime/runtime.env || { echo 'Run configure.py first.' >&2; exit 1; }
docker compose -f compose.yaml build backend frontend
docker compose -f compose.yaml up -d postgres livekit
docker compose -f compose.yaml run --rm --no-deps backend pnpm db:migrate
docker compose -f compose.yaml up -d backend frontend caddy
echo 'Check deployment: docker compose -f deploy/ec2/compose.yaml ps'
