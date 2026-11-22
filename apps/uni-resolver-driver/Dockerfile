# did:bnd driver for the DIF Universal Resolver.
# Build the bundle first (npm run build -w @cashlet-labs/uni-resolver-driver),
# then: docker build -t cashletlabs/uni-resolver-driver-did-bnd:0.1.0 apps/uni-resolver-driver
FROM node:22-alpine
WORKDIR /app
COPY dist/driver.mjs ./driver.mjs
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["node", "driver.mjs"]
