import { createRootRoute, Outlet } from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import { Footer, Header } from "../components/Layout";
import { SessionProvider } from "../state/session";

export const Route = createRootRoute({
  component: () => (
    <SessionProvider>
      <Header />
      <main className="site-main">
        <Outlet />
      </main>
      <Footer />
    </SessionProvider>
  ),
  notFoundComponent: NotFound,
});
