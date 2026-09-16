ARG GO_VERSION=1.27
FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/puretv-worker ./cmd/puretv-worker

FROM build AS test
RUN apk add --no-cache build-base
RUN go vet ./... && CGO_ENABLED=1 go test -race ./... -count=1 -timeout=120s

FROM alpine:3.23 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 1001 -S puretv && adduser -u 1001 -S puretv -G puretv \
    && mkdir -p /data /state && chown puretv:puretv /data /state
COPY --from=build /out/puretv-worker /usr/local/bin/puretv-worker
USER 1001:1001
ENV PURETV_GO_LISTEN_ADDR=0.0.0.0:8081 OFFLINE_DOWNLOAD_DIR=/data PURETV_GO_STATE_DIR=/state
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=6s --start-period=10s --retries=3 CMD ["puretv-worker", "--healthcheck"]
ENTRYPOINT ["puretv-worker"]
