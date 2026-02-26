#!/bin/sh
# =============================================================================
# Frontend entrypoint wrapper
# Translates LOG_LEVEL into nginx access log control before
# delegating to the standard nginx-unprivileged entrypoint.
#
# LOG_LEVEL=debug        → all access logs enabled (including polling)
# LOG_LEVEL=info         → access logs enabled, polling endpoints suppressed (default)
# LOG_LEVEL=warn|error|fatal|silent → all access logs suppressed
# =============================================================================

# Normalize: lowercase + trim whitespace
level=$(printf '%s' "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')

case "$level" in
  debug)
    export NGINX_ACCESS_LOG="/dev/stdout timed"
    export NGINX_POLLING_LOG="/dev/stdout timed"
    echo "[nginx-entrypoint] LOG_LEVEL=${LOG_LEVEL} → access_log on (all requests)"
    ;;
  warn|error|fatal|silent)
    export NGINX_ACCESS_LOG="off"
    export NGINX_POLLING_LOG="off"
    echo "[nginx-entrypoint] LOG_LEVEL=${LOG_LEVEL} → access_log off"
    ;;
  *)
    # info (default): log everything except high-frequency polling endpoints
    export NGINX_ACCESS_LOG="/dev/stdout timed"
    export NGINX_POLLING_LOG="off"
    echo "[nginx-entrypoint] LOG_LEVEL=${LOG_LEVEL:-info} → access_log on (polling suppressed)"
    ;;
esac

# Delegate to the original nginx-unprivileged entrypoint
exec /docker-entrypoint.sh "$@"
