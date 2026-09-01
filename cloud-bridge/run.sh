#!/usr/bin/env sh
set -eu

# Bridge job records, selected reference uploads, and generated files may
# contain private creative material. Do not let the service user's umask make
# them readable by other local users.
umask 077

BRIDGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# .env belongs to the server administrator and must not be committed.
if [ -f "$BRIDGE_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$BRIDGE_DIR/.env"
  set +a
fi

exec python3 "$BRIDGE_DIR/bridge.py"
