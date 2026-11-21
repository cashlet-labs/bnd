import { Link } from "@tanstack/react-router";
import { INTEGRATION_URL, NPM_URL, REPO_URL, SPEC_URL, VECTORS_URL } from "../links";

const STEPS = [
  {
    title: "Bind",
    text: "Your Nostr key and your Bitcoin Cash key each sign one record that names the other. Neither private key leaves its signer.",
  },
  {
    title: "Publish",
    text: "The signed record is an ordinary Nostr event on relays you choose. No server or database owns it.",
  },
  {
    title: "Verify",
    text: "Any app fetches the record and checks both signatures and its whole history itself. Relays are never trusted.",
  },
];

const FEATURES = [
  {
    icon: "✓",
    tone: "green",
    title: "A link anyone can check",
    text: "Look up an npub or a BCH address and see a verified, current link between the two. The BCH proof is a signed message or a transaction that can never be broadcast.",
  },
  {
    icon: "⇄",
    tone: "blue",
    title: "Log in with your keys",
    text: "A one-time challenge signed by both keys, or by the Nostr key alone. Sessions can require both keys for anything that moves value.",
  },
  {
    icon: "↻",
    tone: "amber",
    title: "Rotate and recover",
    text: "Replace a lost or stolen key. Every change needs two of three keys: Nostr, Bitcoin Cash and an optional offline recovery key.",
  },
  {
    icon: "⛨",
    tone: "green",
    title: "Takeover-resistant",
    text: "A stolen Nostr key alone cannot move the identity. The protocol, enforcing relays and verifiers each refuse it.",
  },
  {
    icon: "◎",
    tone: "blue",
    title: "A DID that survives rotation",
    text: "did:bnd names the identity's first binding, so it stays the same when keys change. Resolve it here or with the library.",
  },
  {
    icon: "₿",
    tone: "amber",
    title: "Get paid by name",
    text: "Turn an npub or a DID into a payment request for the identity's current, verified address, in BCH or CashTokens.",
  },
];

const AUDIENCES = [
  {
    title: "For wallets",
    text: "Sign one proof with the connection you already have: a signed message, or a transaction over WizardConnect or WalletConnect.",
    anchor: "#for-bch-wallets",
  },
  {
    title: "For Nostr clients",
    text: "Show a BCH address both keys signed, instead of an unsigned profile field, and refuse revoked or disputed identities.",
    anchor: "#for-nostr-clients",
  },
  {
    title: "For apps",
    text: "Log users in with their keys, resolve did:bnd and take payments, without an identity provider.",
    anchor: "#for-applications-log-in-with-bnd",
  },
];

const STANDARDS = ["Bitcoin Cash", "CashTokens", "Nostr", "W3C DID", "CAIP-122", "BIP-340"];

function External({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: string;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="badge">Open protocol · Bitcoin Cash · Nostr</span>
          <h1>
            One identity.
            <br />
            Two keys.
            <br />
            <span className="accent">Verified by anyone.</span>
          </h1>
          <p className="lead">
            BND is an open protocol that binds a Bitcoin Cash key to a Nostr key. Each key signs for
            the other, the binding lives on Nostr relays, and any application can check it without
            asking a server.
          </p>
          <div className="hero-actions">
            <Link to="/demo" className="btn-primary inline">
              Try the demo
            </Link>
            <External className="btn-secondary inline" href={SPEC_URL}>
              Read the spec
            </External>
            <External className="btn-secondary inline" href={NPM_URL}>
              Install from npm
            </External>
          </div>
          <p className="hero-note">Open source · No accounts · No fees · Your keys stay with you</p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="mock-card">
            <div className="mock-bar">
              <span className="dot red" />
              <span className="dot amber" />
              <span className="dot green" />
            </div>
            <div className="mock-body">
              <span className="mock-label">Nostr</span>
              <code>npub1zutzeysacnf9…d2x7nu</code>
              <span className="mock-label">Bitcoin Cash</span>
              <code>bitcoincash:qrk96lnt…yw66u3y</code>
              <span className="mock-label">DID</span>
              <code>did:bnd:mainnet:1716…ca5c</code>
              <div className="mock-divider" />
              <span className="pill green">✓ Nostr signature</span>
              <span className="pill green">✓ BCH proof</span>
              <span className="pill blue">◎ Current on 3 relays</span>
            </div>
          </div>
        </div>
      </section>

      <ul className="standards" aria-label="Built on">
        <li className="standards-label">Built on</li>
        {STANDARDS.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>

      <section className="section" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="steps-grid">
          {STEPS.map((step, index) => (
            <li className="card" key={step.title}>
              <span className="step">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="features-title">
        <h2 id="features-title">What you get</h2>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <div className="card feature" key={feature.title}>
              <span className={`feature-icon ${feature.tone}`} aria-hidden="true">
                {feature.icon}
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="build-title">
        <h2 id="build-title">Build with it</h2>
        <div className="feature-grid">
          {AUDIENCES.map((audience) => (
            <div className="card feature" key={audience.title}>
              <h3>{audience.title}</h3>
              <p>{audience.text}</p>
              <External className="card-link" href={`${INTEGRATION_URL}${audience.anchor}`}>
                Integration guide →
              </External>
            </div>
          ))}
        </div>
        <div className="install card">
          <div>
            <h3>One package</h3>
            <p>
              Typed, MIT licensed and checked against the specification's test vectors. The core has
              no network code; relay and DID support are separate entry points.
            </p>
            <div className="hero-actions">
              <Link to="/verify" className="btn-secondary inline">
                Verify an identity
              </Link>
              <External className="btn-secondary inline" href={INTEGRATION_URL}>
                Integration guide
              </External>
            </div>
          </div>
          <pre className="code-block">
            <code>
              {`npm install @cashlet-labs/bnd

import { discoverBinding } from "@cashlet-labs/bnd/nostr";

const found = await discoverBinding("npub1…");
if (found.state.status === "current") {
  found.state.binding.bch.address; // verified
}`}
            </code>
          </pre>
        </div>
      </section>

      <section className="section cta card" aria-labelledby="open-title">
        <h2 id="open-title">An open standard</h2>
        <p>
          The specification, the test vectors and every line of code are public. Wallets, Nostr
          clients and apps can implement BND without asking anyone.
        </p>
        <div className="hero-actions">
          <External className="btn-secondary inline" href={SPEC_URL}>
            Read the specification
          </External>
          <External className="btn-secondary inline" href={VECTORS_URL}>
            Test vectors
          </External>
          <External className="btn-secondary inline" href={REPO_URL}>
            Source code
          </External>
        </div>
      </section>
    </>
  );
}
