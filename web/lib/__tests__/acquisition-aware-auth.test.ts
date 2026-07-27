import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  SignIn: () => null,
  SignUp: () => null,
}));

import {
  AcquisitionAwareSignIn,
  AcquisitionAwareSignUp,
} from "@/components/acquisition-aware-auth";

describe("acquisition-aware auth wrappers", () => {
  it("render a loading surface instead of a blank auth page before capture", () => {
    const signIn = renderToStaticMarkup(
      createElement(AcquisitionAwareSignIn, {})
    );
    const signUp = renderToStaticMarkup(
      createElement(AcquisitionAwareSignUp, {})
    );

    expect(signIn).toContain('aria-label="Loading sign-in"');
    expect(signUp).toContain('aria-label="Loading sign-up"');
  });
});
