# syntax=docker/dockerfile:1

FROM node:22.19-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tozalist/api... build

FROM node:22.19-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod \
  && pnpm store prune \
  && find /app/node_modules -type f \( -name '*.ts' -o -name '*.map' -o -name '*.test.*' -o -name '*.integration.test.*' \) -delete \
  && find /app/node_modules -type d \( -name test -o -name tests -o -name __tests__ \) -prune -exec rm -rf '{}' +

FROM node:22.19-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S tozalist && adduser -S -G tozalist tozalist
COPY --from=prod-deps --chown=tozalist:tozalist /app/node_modules ./node_modules
COPY --from=prod-deps --chown=tozalist:tozalist /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps --chown=tozalist:tozalist /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps --chown=tozalist:tozalist /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps --chown=tozalist:tozalist /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --chown=tozalist:tozalist package.json ./package.json
COPY --chown=tozalist:tozalist apps/api/package.json ./apps/api/package.json
COPY --chown=tozalist:tozalist packages/core/package.json ./packages/core/package.json
COPY --chown=tozalist:tozalist packages/db/package.json ./packages/db/package.json
COPY --chown=tozalist:tozalist packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=tozalist:tozalist /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=tozalist:tozalist /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=tozalist:tozalist /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=tozalist:tozalist /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build --chown=tozalist:tozalist /app/packages/shared/dist ./packages/shared/dist
RUN find /app/apps /app/packages -type f \( -name '*.ts' -o -name '*.map' -o -name '*.test.*' -o -name '*.integration.test.*' -o -name 'test-prepare.*' \) -delete
USER tozalist
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
ENTRYPOINT ["node", "apps/api/dist/server.js"]
