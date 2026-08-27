# syntax=docker/dockerfile:1

FROM node:22.19-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @tozalist/api... build \
  && pnpm --filter @tozalist/web build

FROM node:22.19-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
RUN addgroup -S tozalist && adduser -S -G tozalist tozalist
COPY --from=build --chown=tozalist:tozalist /app/apps/web/.next/standalone ./
COPY --from=build --chown=tozalist:tozalist /app/apps/web/.next/static ./apps/web/.next/static
USER tozalist
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/en >/dev/null || exit 1
WORKDIR /app/apps/web
ENTRYPOINT ["node", "server.js"]
