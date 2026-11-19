#!/usr/bin/env bash
# Builds the page and verifier images, starts them on http://127.0.0.1:8088
# without Traefik, checks what the deployment serves, and removes them.
# Set KEEP=1 to leave them running.
set -euo pipefail
cd "$(dirname "$0")/.."

base=http://127.0.0.1:8088
compose() {
  docker compose -p bnd-core-test --env-file site.env -f compose.yaml -f compose.local.yaml "$@"
}

if (echo >/dev/tcp/127.0.0.1/8088) 2>/dev/null; then
  echo "Port 8088 is in use. Stop whatever uses it first." >&2
  exit 1
fi

cleanup() {
  if [ "${KEEP:-}" != 1 ]; then compose down --remove-orphans >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

compose up -d --build --wait

failures=0
check() {
  local name=$1
  shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name" >&2; failures=$((failures + 1)); fi
}
header() { curl -s -D - -o /dev/null "$base$1" | tr -d '\r' | grep -i "^$2:" | cut -d' ' -f2-; }
status() { curl -s -o /dev/null -w '%{http_code}' "${@:2}" "$base$1"; }

expected_csp="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"

check "page is served" test "$(status /)" = 200
check "strict security policy" test "$(header / content-security-policy)" = "$expected_csp"
check "no referrer" test "$(header / referrer-policy)" = no-referrer
check "nosniff" test "$(header / x-content-type-options)" = nosniff
check "same-origin opener" test "$(header / cross-origin-opener-policy)" = same-origin
check "index is revalidated" test "$(header / cache-control)" = no-cache
check "nginx version hidden" test "$(header / server)" = nginx
for route in /demo /verify /no-such-page; do
  check "route $route serves the app" sh -c "curl -s '$base$route' | grep -q '<div id=\"root\">'"
done
asset=$(curl -s "$base/" | grep -o '/assets/[^"]*\.js' | head -n1)
check "assets are cached for good" test "$(header "$asset" cache-control)" = "public, max-age=31536000, immutable"
check "assets keep the security policy" test "$(header "$asset" content-security-policy)" = "$expected_csp"
check "a missing asset is a 404" test "$(status /assets/missing.js)" = 404
# The relay settings are in a chunk loaded on demand, so search the built files.
check "the page names the site's relays" compose exec -T web \
  grep -q -r -e relay.bongacash.co.ke -e "Cashlet relays" /usr/share/nginx/html/assets

challenge=$(curl -s "$base/challenge")
check "challenges come from the verifier" sh -c "echo '$challenge' | grep -q '\"audience\":\"http://127.0.0.1:8088/login\"'"
check "a cross-site login is refused" test "$(status /login -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}')" = 403
check "unknown verifier routes are not proxied" test "$(status /health)" = 200

# The verifier limits challenges per address from X-Real-Ip (30 a minute).
codes=""
for _ in $(seq 1 31); do codes+="$(status /challenge -H 'X-Real-Ip: 198.51.100.1') "; done
check "31st challenge from one address is refused" test "${codes##* 200 }" = "429 "
check "another address still gets one" test "$(status /challenge -H 'X-Real-Ip: 198.51.100.2')" = 200

# compose prints ":0" for a port that is not published.
check "the verifier has no host port" test "$(compose port verifier 8787 2>/dev/null || true)" = ":0"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "All checks passed."
