import WaiversHockeyBroadcastEmail from "../broadcast-2026-09-waivers-hockey";
import {
  definePlunkBroadcast,
  plunkBroadcastSender,
} from "../broadcast-manifest";

/**
 * Local campaign definition. The audience send is a manual dashboard action
 * after explicit approval; no command in this repo schedules or sends it.
 */
export default definePlunkBroadcast({
  id: "sep-2026-waivers-hockey",
  name: "Late September update",
  subject: "Hockey is here, plus better waiver help",
  preview:
    "Waiver priority, FAAB budgets, smarter free agents, and a steadier Yahoo.",
  // The template supplies and validates its own Plunk unsubscribe link. Keep
  // the reviewed Flaim footer intact instead of adding Plunk's standard one.
  type: "HEADLESS",
  releaseGate: {
    status: "CLEARED",
    evidence:
      "No external release dependency; copy reviewed by Gerry in chat 2026-09-29",
  },
  audience: {
    type: "ALL",
    description: "All subscribed Flaim contacts",
  },
  ...plunkBroadcastSender,
  ref: "email-sep-2026-waivers-hockey",
  expectedFlaimPaths: ["/leagues", "/privacy", "/docs/espn"],
  template: WaiversHockeyBroadcastEmail,
});
