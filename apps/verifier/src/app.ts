import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ChallengeStoreFullError,
  isAuthLevel,
  issueChallenge,
  MemoryChallengeStore,
  verifyLogin,
  type AuthLevel,
  type ChallengeStore,
  type LoginResult,
  type VerifiedBinding,
  type VerifyResult,
} from "@cashlet-labs/bnd-core";
import { checkCurrentBinding, type CurrencyCheckOptions } from "@cashlet-labs/bnd-nostr";
import { resolvesToPublicAddresses } from "./address-guard.js";
import { RateLimiter } from "./rate-limit.js";
import { MemoryPinStore, type PinStore } from "./pin-store.js";
import { MemorySessionStore, type Session, type SessionStore } from "./session-store.js";

export interface LoginLogEntry {
  time: string;
  event: "login";
  ok: boolean;
  reason?: string;
  level?: AuthLevel;
  proofType?: string;
  /** Shortened npub: enough to tell users apart in a log, not to copy. */
  npub?: string;
}

export interface VerifierOptions {
  /**
   * The public base URL of this service, for example `https://app.example`.
   * Challenges name `<publicUrl>/login` as their audience.
   */
  publicUrl: string;
  /** Levels clients may ask for. The first is the default. Default `["dual", "nostr"]`. */
  levels?: AuthLevel[];
  /**
   * How to check that a login uses the user's current binding. `false` skips
   * the check, which only makes sense in tests. User relays from NIP-65 lists
   * are checked to resolve to public addresses before any connection.
   */
  currency: CurrencyCheckOptions | false;
  challengeStore?: ChallengeStore;
  sessionStore?: SessionStore;
  /**
   * Remembers each Nostr key's accepted binding and refuses logins with one
   * that does not continue it (section 9). Default: in memory. `false` turns
   * pinning off.
   */
  pinStore?: PinStore | false;
  /** Seconds a session lives without use. Default 1800. */
  sessionIdleSeconds?: number;
  /** Seconds a session lives at most. Default 28800. */
  sessionAbsoluteSeconds?: number;
  /** Challenges one client address may request per minute. Default 30. */
  challengesPerMinute?: number;
  /**
   * A request header that holds the client's address, set by a reverse proxy
   * in front of this service (for example `x-real-ip` behind Traefik). Set it
   * only when every request comes through a proxy that replaces the header;
   * otherwise clients choose their own address. Default: the connection's
   * address.
   */
  clientIpHeader?: string;
  /** Where login log lines go. `false` turns logging off. Default: one JSON line on stdout. */
  log?: ((entry: LoginLogEntry) => void) | false;
  /** Clock in Unix seconds. Tests replace it. */
  now?: () => number;
}

const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const type = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "expected application/json");
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "request body is too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body is too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

/**
 * The rate-limit key for a request. Addresses are hashed with a key made at
 * start-up and kept only in memory, so the limiter never holds an address.
 */
export function clientKeyFor(header: string | undefined): (request: IncomingMessage) => string {
  const secret = randomBytes(32);
  const name = header?.toLowerCase();
  return (request) => {
    const forwarded = name === undefined ? undefined : request.headers[name];
    const fromProxy = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.trim();
    const address = fromProxy || request.socket.remoteAddress || "unknown";
    return createHmac("sha256", secret).update(address.slice(0, 64)).digest("base64url");
  };
}

function shortNpub(npub: string): string {
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}

/** Public view of a session. */
function sessionView(session: Session) {
  return {
    identity: session.identity,
    level: session.level,
    ...(session.bchProofType === undefined ? {} : { bchProofType: session.bchProofType }),
    createdAt: session.createdAt,
  };
}

/**
 * A request handler for Node's `http.createServer`. It serves:
 *
 * - `GET /challenge?level=dual|nostr` a new one-time challenge
 * - `POST /login` a login response; on success sets the session cookie
 * - `GET /me` the session; `?require=dual` refuses a weaker session (step-up)
 * - `POST /logout` ends the session
 */
export function createVerifierHandler(options: VerifierOptions) {
  const base = new URL(options.publicUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new TypeError("publicUrl must be an http or https URL");
  }
  const audience = new URL("/login", base).href;
  const levels = options.levels ?? ["dual", "nostr"];
  if (levels.length === 0 || !levels.every(isAuthLevel)) throw new TypeError("invalid levels");
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const challenges = options.challengeStore ?? new MemoryChallengeStore({ now });
  const sessions =
    options.sessionStore ??
    new MemorySessionStore({
      ...(options.sessionIdleSeconds === undefined
        ? {}
        : { idleSeconds: options.sessionIdleSeconds }),
      ...(options.sessionAbsoluteSeconds === undefined
        ? {}
        : { absoluteSeconds: options.sessionAbsoluteSeconds }),
    });
  const absoluteSeconds = options.sessionAbsoluteSeconds ?? 28_800;
  const limiter = new RateLimiter(options.challengesPerMinute ?? 30, 60);
  const clientKey = clientKeyFor(options.clientIpHeader);
  const https = base.protocol === "https:";
  // The __Host- prefix needs Secure, which plain http cannot set.
  const cookieName = https ? "__Host-bnd_session" : "bnd_session";
  const log =
    options.log === false
      ? undefined
      : (options.log ?? ((entry: LoginLogEntry) => console.log(JSON.stringify(entry))));

  const currency = options.currency;
  const pins = options.pinStore === false ? undefined : (options.pinStore ?? new MemoryPinStore());
  // Runs before the challenge is used up: the pin first (no network), then relays.
  const isCurrent = async (binding: VerifiedBinding): Promise<VerifyResult> => {
    const conflict = pins?.conflict(binding);
    if (conflict) return { ok: false, reason: conflict };
    if (currency === false) return { ok: true };
    const result = await checkCurrentBinding(binding, {
      ...currency,
      allowUserRelay: async (url) =>
        (await (currency.allowUserRelay?.(url) ?? true)) && (await resolvesToPublicAddresses(url)),
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  };

  function setCookie(value: string, maxAge: number): string {
    return [
      `${cookieName}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
      ...(https ? ["Secure"] : []),
    ].join("; ");
  }

  async function currentSession(request: IncomingMessage): Promise<[string, Session] | undefined> {
    const token = readCookie(request, cookieName);
    if (token === undefined) return undefined;
    const session = await sessions.use(token, now());
    return session === undefined ? undefined : [token, session];
  }

  function send(
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    });
    response.end(JSON.stringify(body));
  }

  function logLogin(result: LoginResult): void {
    if (!log) return;
    log({
      time: new Date(now() * 1000).toISOString(),
      event: "login",
      ok: result.ok,
      ...(result.ok
        ? {
            level: result.level,
            ...(result.bchProofType === undefined ? {} : { proofType: result.bchProofType }),
            npub: shortNpub(result.identity.npub),
          }
        : { reason: result.reason }),
    });
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", base);
    const method = request.method ?? "GET";

    // State-changing requests must come from this site. Browsers always send
    // Origin on POST; a request without it is not from a browser page.
    if (method === "POST") {
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== base.origin) {
        throw new HttpError(403, "cross-origin request refused");
      }
    }

    if (method === "GET" && url.pathname === "/challenge") {
      if (!limiter.allow(clientKey(request), now()))
        throw new HttpError(429, "too many challenges, slow down");
      const requested = url.searchParams.get("level") ?? levels[0];
      if (!isAuthLevel(requested) || !levels.includes(requested)) {
        throw new HttpError(400, `level must be one of: ${levels.join(", ")}`);
      }
      try {
        const challenge = await issueChallenge(challenges, {
          audience,
          level: requested,
          now: now(),
        });
        return send(response, 200, challenge);
      } catch (error) {
        if (error instanceof ChallengeStoreFullError) throw new HttpError(503, "try again later");
        throw error;
      }
    }

    if (method === "POST" && url.pathname === "/login") {
      const body = await readJson(request);
      const result = await verifyLogin(challenges, body, {
        now: now(),
        isCurrent,
        ...(pins === undefined ? {} : { checkpoints: pins.checkpoints() }),
      });
      logLogin(result);
      if (!result.ok) return send(response, 401, { error: result.reason });
      pins?.pin(result.binding);
      const previous = await currentSession(request);
      if (previous) await sessions.delete(previous[0]);
      const session: Session = {
        identity: result.identity,
        level: result.level,
        ...(result.bchProofType === undefined ? {} : { bchProofType: result.bchProofType }),
        createdAt: now(),
        lastSeenAt: now(),
      };
      const token = await sessions.create(session);
      return send(response, 200, sessionView(session), {
        "set-cookie": setCookie(token, absoluteSeconds),
      });
    }

    if (method === "GET" && url.pathname === "/me") {
      const current = await currentSession(request);
      if (!current) throw new HttpError(401, "not logged in");
      const required = url.searchParams.get("require");
      if (required !== null) {
        if (!isAuthLevel(required)) throw new HttpError(400, "require must be dual or nostr");
        if (required === "dual" && current[1].level !== "dual") {
          throw new HttpError(403, "this needs a login with both keys");
        }
      }
      return send(response, 200, sessionView(current[1]));
    }

    if (method === "POST" && url.pathname === "/logout") {
      const current = await currentSession(request);
      if (current) await sessions.delete(current[0]);
      return send(response, 200, { ok: true }, { "set-cookie": setCookie("", 0) });
    }

    throw new HttpError(404, "not found");
  }

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      await route(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) send(response, error.status, { error: error.message });
      else send(response, 500, { error: "internal error" });
    }
  };
}
