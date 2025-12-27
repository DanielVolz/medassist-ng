#!/bin/sh
set -e

# Use PUID/PGID from environment, default to 1000
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Ensure data directory exists and has correct ownership
mkdir -p /app/data
chown -R "$PUID:$PGID" /app/data

# Execute the main command as the specified user
exec runuser -u "#$PUID" -- "$@"
