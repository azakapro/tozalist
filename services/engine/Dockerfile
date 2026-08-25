# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/engine .

# Alpine final image: small, and busybox wget is available for the HEALTHCHECK.
FROM alpine:3.20
RUN addgroup -S engine && adduser -S -G engine engine
COPY --from=build /out/engine /usr/local/bin/engine
USER engine

# The engine is internal-only: this port is exposed to the Compose network but
# must never be published to a host. See README.md.
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${ENGINE_PORT:-8080}/health" || exit 1

ENTRYPOINT ["/usr/local/bin/engine"]
