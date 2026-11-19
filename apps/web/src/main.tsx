import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppRouter } from "./router";
import { applyInitialTheme } from "./theme";
import "./styles/fonts.css";
import "./styles/theme.css";
import "./styles/base.css";
import "./styles/site.css";

applyInitialTheme();

const container = document.getElementById("root");
if (container === null) throw new Error("missing #root element");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
