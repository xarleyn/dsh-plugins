import { describe, expect, it } from "vitest";

import {
  addressHost,
  addressLabel,
  normalizeAddress,
  pageLabel,
} from "../src/client/url.js";

describe("panel address field", () => {
  it("assumes the scheme a person would have typed", () => {
    expect(normalizeAddress("example.test")).toBe("https://example.test");
    expect(normalizeAddress("  example.test/qa?x=1  ")).toBe(
      "https://example.test/qa?x=1",
    );
    expect(normalizeAddress("//example.test")).toBe("https://example.test");
    expect(normalizeAddress("http://example.test")).toBe("http://example.test");
  });

  it("reads a port as a port, not as a scheme", () => {
    // `localhost:8080` and `192.168.5.46:3083/qa` both look like `scheme:rest`
    // to a naive parser; a browser takes them as hosts, and so does the panel.
    expect(normalizeAddress("localhost:8080")).toBe("https://localhost:8080");
    expect(normalizeAddress("192.168.5.46:3083/qa")).toBe(
      "https://192.168.5.46:3083/qa",
    );
  });

  it("hands an address with its own scheme to the Host untouched", () => {
    // The policy decides about these; rewriting them here would hide the
    // refusal behind a different address.
    expect(normalizeAddress("about:blank")).toBe("about:blank");
    expect(normalizeAddress("file:///c:/tmp/report.html")).toBe(
      "file:///c:/tmp/report.html",
    );
  });

  it("has nothing to navigate to for an empty field", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
  });

  it("names a tab by its title, its host, or its blankness", () => {
    expect(pageLabel("Example App", "https://example.test/app")).toBe(
      "Example App",
    );
    expect(pageLabel("  ", "https://example.test/app")).toBe("example.test");
    expect(pageLabel("", "about:blank")).toBe("Новая вкладка");
    expect(pageLabel("", "")).toBe("Новая вкладка");
    expect(addressHost("about:blank")).toBeNull();
    expect(addressLabel("about:blank")).toBe("about:blank");
  });
});
