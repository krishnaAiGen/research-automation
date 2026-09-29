# syntax=docker/dockerfile:1

# ---- build ------------------------------------------------------------------
# python3/make/g++ are here because better-sqlite3 compiles from source whenever
# prebuild-install has no binary for the platform; without them that fallback
# fails with a node-gyp error that reads like a missing dependency.
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- run --------------------------------------------------------------------
FROM node:22-bookworm-slim AS run

ENV NODE_ENV=production
# Must point at the mounted volume. On the image's own filesystem the database
# would be discarded with the container.
ENV DATABASE_PATH=/data/app.db

WORKDIR /app

# node_modules is copied whole rather than pruned to production-only, because
# `npm run import` and `npm run reset` run inside this container and both need
# tsx, a devDependency. Costs image size; buys being able to load and reset the
# database on the server.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json

# The volume mounts here. Owned by `node` so the unprivileged user can write the
# database plus its -wal and -shm siblings.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# `npm start` is bare `next start`, which honours $PORT and defaults to 3000.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
