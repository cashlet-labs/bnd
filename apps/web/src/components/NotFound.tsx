import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="page narrow center">
      <span className="badge">404</span>
      <h1>Page not found</h1>
      <p className="lead">There is nothing at this address.</p>
      <Link to="/" className="btn-primary inline">
        Go to the start page
      </Link>
    </div>
  );
}
