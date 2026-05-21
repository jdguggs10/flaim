import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: vi.fn((handler) => handler),
}));

import { normalizePathname, shouldRejectForCsrf } from "../../middleware";

function request(pathname: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://flaim.app${pathname}`, init);
}

describe("normalizePathname", () => {
  it("removes trailing slashes without changing root", () => {
    expect(normalizePathname("/api/webhooks/clerk/")).toBe("/api/webhooks/clerk");
    expect(normalizePathname("/api/webhooks/clerk//")).toBe("/api/webhooks/clerk");
    expect(normalizePathname("/")).toBe("/");
  });
});

describe("shouldRejectForCsrf", () => {
  it("allows Clerk webhooks without a browser origin", () => {
    expect(shouldRejectForCsrf(request("/api/webhooks/clerk", { method: "POST" }))).toBe(false);
    expect(shouldRejectForCsrf(request("/api/webhooks/clerk/", { method: "POST" }))).toBe(false);
  });

  it("allows safe methods without a browser origin", () => {
    expect(shouldRejectForCsrf(request("/api/user/preferences", { method: "GET" }))).toBe(false);
    expect(shouldRejectForCsrf(request("/api/webhooks/clerk", { method: "GET" }))).toBe(false);
  });

  it("rejects mutating API requests without an origin or auth header", () => {
    expect(shouldRejectForCsrf(request("/api/user/preferences", { method: "POST" }))).toBe(true);
  });

  it("rejects non-Clerk webhook paths without a browser origin", () => {
    expect(shouldRejectForCsrf(request("/api/webhooks/stripe", { method: "POST" }))).toBe(true);
  });

  it("allows mutating API requests from allowed origins", () => {
    expect(shouldRejectForCsrf(request("/api/user/preferences", {
      headers: { origin: "https://flaim.app" },
      method: "POST",
    }))).toBe(false);
  });

  it("rejects mutating API requests from disallowed origins", () => {
    expect(shouldRejectForCsrf(request("/api/user/preferences", {
      headers: { origin: "https://example.com" },
      method: "POST",
    }))).toBe(true);
  });

  it("allows mutating API requests with authorization headers", () => {
    expect(shouldRejectForCsrf(request("/api/user/preferences", {
      headers: { authorization: "Bearer token" },
      method: "POST",
    }))).toBe(false);
  });

  it("applies the same CSRF rule to tRPC routes", () => {
    expect(shouldRejectForCsrf(request("/trpc/profile.update", { method: "POST" }))).toBe(true);
    expect(shouldRejectForCsrf(request("/trpc/profile.update", {
      headers: { origin: "https://flaim.app" },
      method: "POST",
    }))).toBe(false);
  });
});
