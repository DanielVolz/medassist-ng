FROM node:22.23.5-bookworm AS node-runtime

FROM mcr.microsoft.com/playwright:v1.65.1-noble

COPY --from=node-runtime /usr/local/ /usr/local/

RUN test "$(node --version)" = "v22.23.5" \
    && test "$(npm --version)" = "10.9.9"
