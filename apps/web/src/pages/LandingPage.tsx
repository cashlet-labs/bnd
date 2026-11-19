import { Link } from "@tanstack/react-router";
import { REPO_URL, SPEC_URL, VECTORS_URL } from "../links";

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
    title: "Verify and log in",
    text: "Any app can fetch the record and check both signatures itself, then log you in with a one-time challenge.",
  },
];

const FEATURES = [
  {
    icon: "⚷",
    tone: "green",
    title: "Two keys, kept apart",
    text: "Separate keys for Nostr and Bitcoin Cash, derived with NIP-06 and BIP44. A binding never needs one key to stand in for the other.",
  },
  {
    icon: "✎",
    tone: "blue",
    title: "Two kinds of BCH proof",
    text: "A signed message, or a signed transaction that spends nothing and can never be broadcast. Verifiers accept both.",
  },
  {
    icon: "◎",
    tone: "amber",
    title: "Discovery without a registry",
    text: "Look up an identity by npub, or find who claims a BCH address. Relays only carry data; they are never trusted.",
  },
  {
    icon: "✓",
    tone: "green",
    title: "Independent verification",
    text: "Every check runs where you are: in this page, in your app, on your server. No identity authority is asked.",
  },
  {
    icon: "⇄",
    tone: "blue",
    title: "Challenge-response login",
    text: "A CAIP-122 sign-in message and a NIP-98 event, one-time and short-lived, with sessions that can require both keys.",
  },
  {
    icon: "⌘",
    tone: "amber",
    title: "Built to be adopted",
    text: "An open specification, shared test vectors, and wallet connections through WizardConnect or any signer you plug in.",
  },
];

export function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="badge">Bitcoin Cash · Nostr · Open protocol</span>
          <h1>
            One identity.
            <br />
            Two keys.
            <br />
            <span className="accent">Verified by anyone.</span>
          </h1>
          <p className="lead">
            BND binds a Bitcoin Cash key to a Nostr key. Each key signs for the other, the binding
            lives on Nostr relays, and any application can check it without asking a server.
          </p>
          <div className="hero-actions">
            <Link to="/demo" className="btn-primary inline">
              Try the demo
            </Link>
            <Link to="/verify" className="btn-secondary inline">
              Verify an identity
            </Link>
          </div>
          <p className="hero-note">Open source · MIT licence · No accounts</p>
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
              <div className="mock-divider" />
              <span className="pill green">✓ Nostr signature</span>
              <span className="pill green">✓ BCH proof</span>
              <span className="pill blue">◎ Found on 3 relays</span>
            </div>
          </div>
        </div>
      </section>

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

      <section className="section cta card" aria-labelledby="open-title">
        <h2 id="open-title">An open standard</h2>
        <p>
          The specification, the test vectors and every line of code are public. Wallets, Nostr
          clients and apps can implement BND without asking anyone.
        </p>
        <div className="hero-actions">
          <a
            className="btn-secondary inline"
            href={SPEC_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the specification
          </a>
          <a
            className="btn-secondary inline"
            href={VECTORS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Test vectors
          </a>
          <a
            className="btn-secondary inline"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Source code
          </a>
        </div>
      </section>
    </>
  );
}
