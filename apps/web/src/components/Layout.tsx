import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import logo from "../assets/logo.png";
import { NPM_URL, REPO_URL, SEPTEM_URL, SPEC_URL } from "../links";
import { ThemeToggle } from "./ThemeToggle";

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="BND home">
      <img src={logo} alt="" width={28} height={28} />
      <span className="brand-name">BND</span>
      <span className="brand-product">Open protocol</span>
    </Link>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Main">
        <Brand />
        <div className="nav-links">
          <Link to="/demo" activeProps={{ className: "active" }}>
            Demo
          </Link>
          <Link to="/verify" activeProps={{ className: "active" }}>
            Verify
          </Link>
          <a href={SPEC_URL} target="_blank" rel="noopener noreferrer">
            Spec
          </a>
          <a className="nav-optional" href={NPM_URL} target="_blank" rel="noopener noreferrer">
            npm
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img src={logo} alt="" width={20} height={20} />
          <span>BND</span>
          <span className="muted">
            An open protocol by{" "}
            <a href={SEPTEM_URL} target="_blank" rel="noopener noreferrer">
              Septem Labs
            </a>{" "}
            · MIT
          </span>
        </div>
        <div className="footer-links">
          <Link to="/demo">Demo</Link>
          <Link to="/verify">Verify</Link>
          <a href={SPEC_URL} target="_blank" rel="noopener noreferrer">
            Spec
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="page-header">
      <span className="badge">{eyebrow}</span>
      <h1>{title}</h1>
      <p className="lead">{children}</p>
    </div>
  );
}
