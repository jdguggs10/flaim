import "server-only";

export type WelcomeDeliveryMode = "automation" | "direct" | "disabled";

export interface WelcomeDeliveryConfig {
  invalidValue?: string;
  mode: WelcomeDeliveryMode;
  source: "explicit" | "legacy";
}

/**
 * Keep the deployed behavior unchanged until one explicit mode selects the
 * direct sender. Invalid explicit values fail closed instead of falling back
 * to the contact-creating automation.
 */
export function getWelcomeDeliveryConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WelcomeDeliveryConfig {
  const explicit = env.FLAIM_WELCOME_DELIVERY_MODE?.trim().toLowerCase();

  if (explicit === "automation" || explicit === "direct" || explicit === "disabled") {
    return { mode: explicit, source: "explicit" };
  }

  if (explicit) {
    return { invalidValue: explicit, mode: "disabled", source: "explicit" };
  }

  return {
    mode: env.RESEND_WELCOME_AUTOMATION_ENABLED === "true" ? "automation" : "disabled",
    source: "legacy",
  };
}
