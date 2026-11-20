# Hosting the demo

The hosted demo is the same page and verifier as `npm run demo`, packaged as
two containers:

| Container  | Image               | Role                                                           |
| ---------- | ------------------- | -------------------------------------------------------------- |
| `web`      | `bnd-core/web`      | nginx serving the built page, forwarding the verifier's routes |
| `verifier` | `bnd-core/verifier` | The demo login service, bundled into one file, on Node 22      |

```text
browser ──https──▶ reverse proxy ──▶ web (nginx :8080) ──┬──▶ the page's files
                                                        └──▶ verifier :8787   /challenge /login /me /logout
```

The page and the verifier share one origin, as in the local demo, so the
session cookie stays `SameSite=Strict` and no CORS is needed. Only `web` is
exposed to the reverse proxy; the verifier is reachable only from `web`.

The files are in `deploy/`:

| File                               | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `web/Dockerfile`, `web/nginx.conf` | Builds the page with Vite; nginx config with the SPA fallback |
| `web/write-nginx-headers.ts`       | Writes the security headers for nginx at build time           |
| `verifier/Dockerfile`, `build.mjs` | Bundles the verifier and the BND packages with esbuild        |
| `compose.yaml`                     | Both services, hardened                                       |
| `compose.local.yaml`               | Publishes the page on `http://127.0.0.1:8088` for local tests |
| `compose.traefik.yaml`             | Traefik labels for the hosted demo                            |
| `site.env`                         | The hosted demo's host name and relays                        |
| `scripts/test-deploy.sh`           | Builds both images and checks what they serve                 |

## Settings

`site.env` holds everything specific to one site:

| Variable              | Meaning                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `SITE_HOST`           | Host name the page is served on. The verifier's `PUBLIC_URL` is `https://<SITE_HOST>`.   |
| `SITE_RELAYS`         | The site's own relays: the page's default, and first for NIP-46 signers (`VITE_RELAYS`). |
| `SITE_RELAYS_LABEL`   | What the page calls them (`VITE_RELAYS_LABEL`)                                           |
| `VERIFIER_RELAYS`     | Relays the verifier asks whether a login uses the current binding, own relays first      |
| `VERIFIER_MIN_RELAYS` | Complete relay answers needed before a login is decided (default 2)                      |

The relay settings are built into the page, so changing them needs a rebuild.

## Testing locally

```bash
deploy/scripts/test-deploy.sh
```

It builds both images, starts them on `http://127.0.0.1:8088`, and checks:

- the security headers on the page and its files, and that nginx hides its version;
- that every app route (`/demo`, `/verify`, unknown paths) serves the app, and
  hashed files are cached for good while `index.html` is revalidated;
- that the built page names the site's relays;
- that `/challenge` reaches the verifier, and a cross-site login is refused;
- the per-client challenge limit (30 a minute) by `X-Real-Ip`;
- that the verifier has no host port.

The containers are removed afterwards; `KEEP=1` leaves them running, so the
page can be tried in a browser at `http://127.0.0.1:8088`.

## Running behind a reverse proxy

```bash
cd deploy
docker compose --env-file site.env -f compose.yaml -f compose.traefik.yaml up -d --build
```

`compose.traefik.yaml` assumes a Traefik with an entry point `websecure`, a
Let's Encrypt resolver `letsencrypt` and an external Docker network `web`.
For another proxy, send the host's HTTPS traffic to `web` on port 8080.

The proxy must set `X-Real-Ip` to the client's address and replace any value
the client sent. The verifier trusts that header for its rate limit
(`BND_CLIENT_IP_HEADER=x-real-ip`), and nginx passes it on. Traefik does this
by default, unless its entry point sets `forwardedHeaders.insecure` or
`forwardedHeaders.trustedIPs`. Without a proxy that replaces the header, leave
`BND_CLIENT_IP_HEADER` unset.

## What the deployment protects

- **Headers:** the same strict policy as `vite preview` (see
  [demo.md](demo.md#page-security)), generated from
  `apps/web/security-headers.ts`, on every response including errors.
- **Visitors' addresses:** nginx keeps no access log. The verifier uses the
  address only for its rate limit, as an HMAC under a key made at start-up and
  held in memory, and its login log has no addresses.
- **Containers:** read-only root file systems, no Linux capabilities,
  `no-new-privileges`, memory limits, and non-root users (nginx as 101, the
  verifier as `node`). Logs rotate at 10 MB.
- **Images:** base images pinned by digest; the verifier image holds one bundled
  file and no `node_modules`.

## Changing the host name

Bindings name no domain, so moving the demo does not affect any binding.

1. Point the new name's DNS (A and AAAA) at the server.
2. Set `SITE_HOST` in `site.env`.
3. Rebuild and restart. The proxy requests the new certificate.

Challenges name `https://<SITE_HOST>/login` as their audience, and session
cookies belong to the host, so open challenges and sessions on the old name
stop working. Users log in again.

The hosted demo currently runs at `https://bnd.septemlabs.com`.
