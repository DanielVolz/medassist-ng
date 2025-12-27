#!/bin/sh
set -e

# Use PUID/PGID from environment, default to 1000
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "[entrypoint] Starting with PUID=$PUID, PGID=$PGID"
echo "[entrypoint] Running as: $(id)"

# Show mount info
echo "[entrypoint] Mounts:"
cat /proc/mounts | grep -E "app|data" || echo "no app/data mounts found"

# Ensure data directory exists
mkdir -p /app/data
echo "[entrypoint] /app/data exists"

# Show what we have
echo "[entrypoint] ls -la /app/data:"
ls -la /app/data/

# Try writing directly and show the error
echo "[entrypoint] Attempting write test..."
touch /app/data/.write-test && echo "[entrypoint] Write OK" && rm -f /app/data/.write-test || {
    echo "[entrypoint] Write FAILED. Error:"
    touch /app/data/.write-test 2>&1 || true
}

# If we can't write, try to understand why
if [ ! -w /app/data ]; then
    echo "[entrypoint] /app/data is not writable by $(id)"
fi

# Show current ownership before chown
echo "[entrypoint] Before chown:"
ls -la /app/data/

# Try to chown - this may fail on bind mounts owned by different host user
if chown -R "$PUID:$PGID" /app/data 2>&1; then
    echo "[entrypoint] Set ownership of /app/data to $PUID:$PGID"
else
    echo "[entrypoint] WARNING: chown failed (bind mount may have different host ownership)"
fi

# Show ownership after chown attempt
echo "[entrypoint] After chown:"
ls -la /app/data/

# Check if we can write to data directory
if touch /app/data/.write-test 2>/dev/null; then
    rm -f /app/data/.write-test
    echo "[entrypoint] Write test passed"
else
    echo "[entrypoint] ERROR: Cannot write to /app/data"
    echo "[entrypoint] FIX: Run on host: sudo chown -R $PUID:$PGID <your-data-path>"
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
