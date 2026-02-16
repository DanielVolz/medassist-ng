#!/bin/sh
# =============================================================================
# Frontend entrypoint wrapper
# Translates LOG_LEVEL into nginx access log control before
# delegating to the standard nginx-unprivileged entrypoint.
#
# LOG_LEVEL=debug|info  → access logs enabled  (default)
# LOG_LEVEL=warn|error|fatal|silent → access logs suppressed
# =============================================================================

# Normalize: lowercase + trim whitespace
level=$(printf '%s' "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')

case "$level" in
  warn|error|fatal|silent)
    export NGINX_ACCESS_LOG="off"
    echo "[nginx-entrypoint] LOG_LEVEL=${LOG_LEVEL} → access_log off"
    ;;
  *)
    export NGINX_ACCESS_LOG="/dev/stdout"
    echo "[nginx-entrypoint] LOG_LEVEL=${LOG_LEVEL:-info} → access_log /dev/stdout"
    ;;
esac

# Delegate to the original nginx-unprivileged entrypoint
exec /docker-entrypoint.sh "$@"
