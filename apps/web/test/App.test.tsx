import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";

afterEach(cleanup);

describe("App", () => {
  it("renders the demo heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("BND identity demo");
  });
});
