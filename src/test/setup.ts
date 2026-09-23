import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"] as const) {
  if (!(method in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: method === "hasPointerCapture" ? () => false : () => undefined,
    });
  }
}

afterEach(cleanup);
