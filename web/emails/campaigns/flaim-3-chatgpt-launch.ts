import FlaimThreeLaunchBroadcastEmail from "../broadcast-2026-09-v3-launch";
import {
  definePlunkBroadcast,
  plunkBroadcastSender,
} from "../broadcast-manifest";

/**
 * Local campaign definition only. Do not create a Plunk draft or send a proof
 * until OpenAI has approved Flaim 3.0 in the ChatGPT app directory.
 */
export default definePlunkBroadcast({
  id: "flaim-3-chatgpt-launch",
  name: "Flaim 3.0 launch",
  subject: "Flaim 3.0 is now live in ChatGPT",
  preview:
    "Draft results, pick ownership, and deeper ESPN football matchup context are now available.",
  type: "MARKETING",
  releaseGate: {
    status: "PENDING",
    requirement: "OpenAI approves Flaim 3.0 in the ChatGPT app-directory portal",
  },
  audience: {
    type: "ALL",
    description: "All subscribed Flaim contacts",
  },
  ...plunkBroadcastSender,
  ref: "email-flaim-3-chatgpt-launch",
  expectedFlaimPaths: ["/"],
  template: FlaimThreeLaunchBroadcastEmail,
});
