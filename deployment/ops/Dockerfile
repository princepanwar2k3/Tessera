# Secondary/optional path for running the daemon itself in a container.
# Primary recommended path is running directly on the VPS host via the
# systemd unit in this directory — see RUNBOOK.md for why.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/daemon/package.json packages/daemon/package.json
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/daemon packages/daemon
RUN pnpm --filter @bsp/daemon build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/packages/daemon/dist ./dist
COPY --from=build /app/packages/daemon/package.json ./package.json
RUN corepack enable && pnpm install --prod
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
