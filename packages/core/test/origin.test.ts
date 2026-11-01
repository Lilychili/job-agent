import { describe, expect, it } from "vitest";
import { isLocalRequest } from "../src/origin";

const local = "127.0.0.1:3000";
const base = { method: "POST", host: local, origin: null, fetchSite: null };

describe("isLocalRequest", () => {
  it("allows the app talking to itself, and local tools", () => {
    expect(isLocalRequest({ ...base, origin: "http://127.0.0.1:3000", fetchSite: "same-origin" })).toBe(true);
    expect(isLocalRequest({ ...base, host: "localhost:3000", origin: "http://localhost:3000" })).toBe(true);
    expect(isLocalRequest(base)).toBe(true); // curl
  });

  it("blocks DNS rebinding: a foreign Host, even on a read", () => {
    expect(isLocalRequest({ ...base, method: "GET", host: "evil.example" })).toBe(false);
    expect(isLocalRequest({ ...base, method: "GET", host: "127.0.0.1.evil.example:3000" })).toBe(false);
    expect(isLocalRequest({ ...base, method: "GET", host: null })).toBe(false);
  });

  it("blocks cross-site writes", () => {
    expect(isLocalRequest({ ...base, origin: "https://evil.example" })).toBe(false);
    expect(isLocalRequest({ ...base, origin: "null" })).toBe(false);
    expect(isLocalRequest({ ...base, method: "DELETE", origin: "http://127.0.0.1:9999" })).toBe(false);
    expect(isLocalRequest({ ...base, fetchSite: "cross-site" })).toBe(false);
    expect(isLocalRequest({ ...base, fetchSite: "same-site" })).toBe(false);
  });

  it("lets a link from elsewhere open a page", () => {
    expect(isLocalRequest({ ...base, method: "GET", origin: null, fetchSite: "cross-site" })).toBe(true);
  });
});
