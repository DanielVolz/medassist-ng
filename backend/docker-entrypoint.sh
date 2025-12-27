#!/bin/sh
set -e

# Use PUID/PGID from environment, default to 1000
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "[entrypoint] Starting with PUID=$PUID, PGID=$PGID"

# Ensure data directory exists with correct ownership
# Note: With cap_drop ALL, root can't write to dirs owned by others (no DAC_OVERRIDE)
# So we create the dir and immediately chown it
if [ ! -d /app/data ]; then
    mkdir -p /app/data
    echo "[entrypoint] Created /app/data"
fi

# Set ownership (requires CHOWN capability)
chown -R "$PUID:$PGID" /app/data 2>/dev/null || echo "[entrypoint] chown skipped (already correct or no permission)"

# Write test must run AS the target user (root can't write without DAC_OVERRIDE cap)
echo "[entrypoint] Testing write access as user $PUID..."
if gosu "$PUID:$PGID" touch /app/data/.write-test 2>/dev/null; then
    gosu "$PUID:$PGID" rm -f /app/data/.write-test
    echo "[entrypoint] Write test passed"
else
    echo "[entrypoint] ERROR: User $PUID cannot write to /app/data"
    echo "[entrypoint] Directory info:"
    ls -la /app/data/
    echo "[entrypoint] FIX: On host run: sudo chown -R $PUID:$PGID <your-data-path>"
    exit 1
fi

# Start app as the specified user
echo "[entrypoint] Starting app as user $PUID:$PGID"
exec gosu "$PUID:$PGID" "$@"
