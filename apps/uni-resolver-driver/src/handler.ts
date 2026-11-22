import type { IncomingMessage, ServerResponse } from "node:http";
import {
  resolveDid,
  type DidResolutionResult,
  type ResolveDidOptions,
} from "@cashlet-labs/bnd/did";

/**
 * A did:bnd driver for the DIF Universal Resolver.
 *
 * It answers `GET /1.0/identifiers/{did}` as the DID Resolution HTTP binding
 * describes: a DID Resolution Result by default, or only the DID document when
 * the client asks for `application/did+ld+json` or `application/did+json`.
 * Relays are untrusted: every binding is verified locally, and too few complete
 * relay answers is an error, never a stale document.
 */

export interface DriverOptions {
  /** Passed to resolveDid: relays, minComplete, and a WebSocket for tests. */
  resolve: ResolveDidOptions;
  /** Driver version, reported by /health. */
  version: string;
}

const RESULT_TYPE = 'application/ld+json;profile="https://w3id.org/did-resolution"';
const DOCUMENT_TYPES = ["application/did+ld+json", "application/did+json"] as const;
const MAX_DID_CHARS = 300;

/** HTTP status for a resolution result (DID Resolution, HTTP binding). */
export function statusOf(result: DidResolutionResult): number {
  const metadata = result.didResolutionMetadata;
  if (!("error" in metadata)) return result.didDocumentMetadata.deactivated ? 410 : 200;
  switch (metadata.error) {
    case "invalidDid":
      return 400;
    case "notFound":
      return 404;
    case "conflict":
      return 409;
    default:
      return 500;
  }
}

/** Which document-only type the client asked for, if any. A resolution result is the default. */
function documentType(accept: string | undefined): (typeof DOCUMENT_TYPES)[number] | null {
  if (!accept) return null;
  const asked = accept.split(",").map((part) => part.split(";")[0]!.trim().toLowerCase());
  return DOCUMENT_TYPES.find((type) => asked.includes(type)) ?? null;
}

function send(response: ServerResponse, status: number, type: string, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    "content-type": `${type};charset=utf-8`,
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(text);
}

export function createDriverHandler(options: DriverOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", "http://driver");
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      if (url.pathname === "/health") {
        send(response, 200, "application/json", { ok: true, version: options.version });
        return;
      }
      const prefix = "/1.0/identifiers/";
      if (!url.pathname.startsWith(prefix)) {
        send(response, 404, "application/json", { error: "not found" });
        return;
      }
      let did = url.pathname.slice(prefix.length);
      try {
        did = decodeURIComponent(did);
      } catch {
        // A malformed escape is resolved as written, and fails as an invalid DID.
      }
      if (did.length > MAX_DID_CHARS) did = did.slice(0, MAX_DID_CHARS);

      const resolved = await resolveDid(did, options.resolve);
      const result: DidResolutionResult = {
        didDocument: resolved.didDocument,
        didResolutionMetadata: resolved.didResolutionMetadata,
        didDocumentMetadata: resolved.didDocumentMetadata,
      };
      const status = statusOf(result);
      const wanted = documentType(request.headers.accept);
      if (wanted && result.didDocument && status === 200) {
        // JSON-LD documents keep @context; plain JSON leaves it out.
        const { "@context": context, ...plain } = result.didDocument;
        send(
          response,
          200,
          wanted,
          wanted === "application/did+json" ? plain : { "@context": context, ...plain },
        );
        return;
      }
      send(response, status, RESULT_TYPE, result);
    } catch {
      if (!response.headersSent)
        send(response, 500, "application/json", { error: "internal error" });
      else response.end();
    }
  };
}
