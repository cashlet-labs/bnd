# The BND page: built with Vite, served by nginx.
# Build from the repository root: docker build -f deploy/web/Dockerfile .

ARG NODE=node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
ARG NGINX=nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e

FROM ${NODE} AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/bnd/package.json packages/bnd/
COPY apps/dev-relay/package.json apps/dev-relay/
COPY apps/verifier/package.json apps/verifier/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages ./packages
COPY apps/web ./apps/web
COPY deploy/web ./deploy/web
# The site's own relays and how the page names them; see docs/deploy.md.
ARG VITE_RELAYS
ARG VITE_RELAYS_LABEL
ENV VITE_RELAYS=${VITE_RELAYS} VITE_RELAYS_LABEL=${VITE_RELAYS_LABEL}
RUN npx vite build apps/web \
 && npx tsx deploy/web/write-nginx-headers.ts > /build/security-headers.conf

FROM ${NGINX}
COPY deploy/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /build/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /build/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
