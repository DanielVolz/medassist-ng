#!/bin/sh
set -e

# Use PUID/PGID from environment, default to 1000
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "[entrypoint] Starting with PUID=$PUID, PGID=$PGID"

# Ensure data directory exists and has correct ownership
mkdir -p /app/data
echo "[entrypoint] Created /app/data"

chown -R "$PUID:$PGID" /app/data
echo "[entrypoint] Set ownership of /app/data to $PUID:$PGID"

# Check if we can write to data directory
if touch /app/data/.write-test 2>/dev/null; then
    rm -f /app/data/.write-test
    echo "[entrypoint] Write test passed"
else
    echo "[entrypoint] ERROR: Cannot write to /app/data"
    ls -la /app/
    exit 1
fi

# Execute the main command as the specified user
# Try different methods for dropping privileges
if command -v gosu >/dev/null 2>&1; then
    echo "[entrypoint] Using gosu"
    exec gosu "$PUID:$PGID" "$@"
elif command -v su-exec >/dev/null 2>&1; then
    echo "[entrypoint] Using su-exec"
    exec su-exec "$PUID:$PGID" "$@"
else
    echo "[entrypoint] Using su"
    # Create a temporary user with the specified UID if it doesn't exist
    if ! id -u "$PUID" >/dev/null 2>&1; then
        echo "[entrypoint] UID $PUID doesn't exist, running as node user"
        exec su -s /bin/sh node -c "exec $*"
    else
        exec su -s /bin/sh "#$PUID" -c "exec $*"
    fi
fi
