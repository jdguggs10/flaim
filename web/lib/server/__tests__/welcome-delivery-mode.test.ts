import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getWelcomeDeliveryConfig } from "../welcome-delivery-mode";

describe("getWelcomeDeliveryConfig", () => {
  it("preserves the legacy automation flag when the new mode is absent", () => {
    expect(getWelcomeDeliveryConfig({ RESEND_WELCOME_AUTOMATION_ENABLED: "true" })).toEqual({
      mode: "automation",
      source: "legacy",
    });
    expect(getWelcomeDeliveryConfig({ RESEND_WELCOME_AUTOMATION_ENABLED: "false" })).toEqual({
      mode: "disabled",
      source: "legacy",
    });
  });

  it("lets one explicit value select direct delivery", () => {
    expect(getWelcomeDeliveryConfig({
      FLAIM_WELCOME_DELIVERY_MODE: " DIRECT ",
      RESEND_WELCOME_AUTOMATION_ENABLED: "true",
    })).toEqual({
      mode: "direct",
      source: "explicit",
    });
  });

  it("fails closed for an invalid explicit value", () => {
    expect(getWelcomeDeliveryConfig({
      FLAIM_WELCOME_DELIVERY_MODE: "both",
      RESEND_WELCOME_AUTOMATION_ENABLED: "true",
    })).toEqual({
      invalidValue: "both",
      mode: "disabled",
      source: "explicit",
    });
  });
});
