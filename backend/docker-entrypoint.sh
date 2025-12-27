#!/bin/sh
set -e

# Ensure data directory exists and has correct ownership
# This script runs as root, fixes permissions, then node runs as appuser via USER directive
mkdir -p /app/data
chown -R 1000:1000 /app/data

# Execute the main command as appuser (UID 1000)
exec runuser -u appuser -- "$@"
