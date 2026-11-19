# The BND demo verifier, bundled into one file by deploy/verifier/build.mjs.
# Build from the repository root: docker build -f deploy/verifier/Dockerfile .

ARG NODE=node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

FROM ${NODE} AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/nostr/package.json packages/nostr/
COPY apps/dev-relay/package.json apps/dev-relay/
COPY apps/verifier/package.json apps/verifier/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages ./packages
COPY apps/verifier ./apps/verifier
COPY deploy/verifier/build.mjs ./deploy/verifier/
RUN node deploy/verifier/build.mjs

FROM ${NODE}
WORKDIR /app
COPY --from=build /build/deploy/verifier/dist/ /app/
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
# A TCP check: the verifier has no health route, and a challenge would count
# against the rate limit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('node:net').connect(8787,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "/app/verifier.mjs"]
