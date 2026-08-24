# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS build
WORKDIR /src

# No third-party dependencies yet; go.mod alone is enough to warm the cache.
COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/engine .

# Distroless static: no shell, no package manager, non-root by default.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/engine /usr/local/bin/engine
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/engine"]
