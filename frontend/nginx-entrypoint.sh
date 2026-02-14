#!/bin/sh
# =============================================================================
# Frontend entrypoint wrapper
# Translates LOG_LEVEL into nginx access log control before
# delegating to the standard nginx-unprivileged entrypoint.
#
# LOG_LEVEL=debug|info  → access logs enabled  (default)
# LOG_LEVEL=warn|error|fatal|silent → access logs suppressed
# =============================================================================

case "${LOG_LEVEL:-info}" in
  warn|error|fatal|silent)
    export NGINX_ACCESS_LOG="off"
    ;;
  *)
    export NGINX_ACCESS_LOG="/dev/stdout"
    ;;
esac

# Delegate to the original nginx-unprivileged entrypoint
exec /docker-entrypoint.sh "$@"
