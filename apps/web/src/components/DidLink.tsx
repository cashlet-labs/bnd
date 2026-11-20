import { didOf } from "@cashlet-labs/bnd-did";
import type { VerifiedBinding } from "@cashlet-labs/bnd-core";

/**
 * The identity's did:bnd, which stays the same across key rotations, with a
 * link to this site's public resolver.
 */
export function DidFact({ binding }: { binding: VerifiedBinding }) {
  const did = didOf(binding);
  return (
    <>
      <dt>DID</dt>
      <dd>
        <code className="wrap" aria-label="DID">
          {did}
        </code>{" "}
        <a href={`/did/${encodeURIComponent(did)}`} target="_blank" rel="noreferrer">
          Resolve
        </a>
      </dd>
    </>
  );
}
