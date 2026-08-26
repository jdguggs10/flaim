import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as React from "react";
import { render } from "@react-email/render";
import { Resend } from "resend";
import WelcomeEmailModule from "../emails/welcome.tsx";

// tsx wraps a .tsx default export when it is imported from this .mjs runner.
const WelcomeEmail = WelcomeEmailModule.default ?? WelcomeEmailModule;

const EVENT_NAME = "flaim.user_created";
const TEMPLATE_ALIAS = "flaim-welcome-v1";
const TEMPLATE_NAME = "Flaim Welcome";
const AUTOMATION_NAME = "Flaim Welcome Email";
const EVENT_SCHEMA_VERSION = "2026-08-25-no-given-name";
const RESEND_PROPAGATION_DELAY_MS = 300;
const MAX_TEMPLATE_LIST_PAGES = 20;
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertSuccess(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? "Unknown Resend error"}`);
  }

  return result.data;
}

async function ensureEvent(resend) {
  const events = assertSuccess(await resend.events.list(), "List Resend events");
  const existing = events.data.find((event) => event.name === EVENT_NAME);
  const schema = {
    clerk_user_id: "string",
    source: "string",
  };

  if (existing) {
    assertSuccess(
      await resend.events.update(existing.id, { schema }),
      "Update Resend welcome event",
    );
    return existing.id;
  }

  const created = assertSuccess(
    await resend.events.create({ name: EVENT_NAME, schema }),
    "Create Resend welcome event",
  );
  return created.id;
}

function createWelcomeAutomationEmail() {
  return React.createElement(WelcomeEmail, {
    unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
  });
}

export function buildWelcomeHtml() {
  return render(createWelcomeAutomationEmail());
}

export function buildWelcomeText() {
  return render(createWelcomeAutomationEmail(), { plainText: true });
}

export async function buildWelcomeTemplate() {
  return {
    alias: TEMPLATE_ALIAS,
    from: "Flaim <updates@flaim.app>",
    html: await buildWelcomeHtml(),
    name: TEMPLATE_NAME,
    replyTo: "support@flaim.app",
    subject: "Welcome to Flaim",
    text: await buildWelcomeText(),
    variables: [],
  };
}

async function ensureTemplate(resend) {
  const payload = await buildWelcomeTemplate();
  const existing = await findTemplateByAlias(resend, TEMPLATE_ALIAS);

  if (existing) {
    assertSuccess(
      await resend.templates.update(existing.id, payload),
      "Update Resend welcome template",
    );
    assertSuccess(
      await resend.templates.publish(existing.id),
      "Publish Resend welcome template",
    );
    return existing.id;
  }

  const created = assertSuccess(
    await resend.templates.create(payload),
    "Create Resend welcome template",
  );
  assertSuccess(
    await resend.templates.publish(created.id),
    "Publish Resend welcome template",
  );
  return created.id;
}

async function findTemplateByAlias(resend, alias) {
  let cursor;
  let pagesFetched = 0;

  while (true) {
    pagesFetched += 1;
    if (pagesFetched > MAX_TEMPLATE_LIST_PAGES) {
      throw new Error(`Resend template lookup exceeded ${MAX_TEMPLATE_LIST_PAGES} pages`);
    }

    const page = assertSuccess(
      await resend.templates.list({ limit: 100, ...(cursor ? { after: cursor } : {}) }),
      "List Resend templates",
    );
    const existing = page.data.find((template) => template.alias === alias);

    if (existing) return existing;
    if (!page.has_more || page.data.length === 0) return null;

    cursor = page.data[page.data.length - 1].id;
  }
}

export function buildAutomation(templateId, contactSegmentId) {
  return {
    connections: [
      { from: "start", to: "segment" },
      { from: "segment", to: "welcome" },
    ],
    name: AUTOMATION_NAME,
    status: "disabled",
    steps: [
      {
        key: "start",
        type: "trigger",
        config: { eventName: EVENT_NAME },
      },
      {
        key: "segment",
        type: "add_to_segment",
        config: {
          segmentId: contactSegmentId,
        },
      },
      {
        key: "welcome",
        type: "send_email",
        config: {
          from: "Flaim <updates@flaim.app>",
          replyTo: "support@flaim.app",
          subject: "Welcome to Flaim",
          template: {
            id: templateId,
          },
        },
      },
    ],
  };
}

async function ensureAutomation(resend, templateId, contactSegmentId) {
  const automations = assertSuccess(
    await resend.automations.list(),
    "List Resend automations",
  );
  const payload = buildAutomation(templateId, contactSegmentId);
  const existing = automations.data.find(
    (automation) => automation.name === AUTOMATION_NAME,
  );

  if (existing) {
    assertSuccess(
      await resend.automations.update(existing.id, payload),
      "Update Resend welcome automation",
    );
    return existing.id;
  }

  const created = assertSuccess(
    await resend.automations.create(payload),
    "Create Resend welcome automation",
  );
  return created.id;
}

async function main() {
  const apiKey = process.env.RESEND_EVENTS_API_KEY ?? process.env.RESEND_CONTACTS_API_KEY;
  const contactSegmentId = process.env.RESEND_CONTACT_SEGMENT_ID?.trim();

  if (!apiKey) {
    throw new Error("RESEND_EVENTS_API_KEY or RESEND_CONTACTS_API_KEY is required");
  }

  if (!contactSegmentId) {
    throw new Error("RESEND_CONTACT_SEGMENT_ID is required");
  }

  const resend = new Resend(apiKey);
  const eventId = await ensureEvent(resend);
  // Resend's management API can briefly lag between dependent resource writes.
  await sleep(RESEND_PROPAGATION_DELAY_MS);
  const templateId = await ensureTemplate(resend);
  await sleep(RESEND_PROPAGATION_DELAY_MS);
  const automationId = await ensureAutomation(resend, templateId, contactSegmentId);

  console.log(JSON.stringify({
    automationId,
    automationStatus: "disabled",
    // Informational only. The automation binds to the event by name.
    eventId,
    eventName: EVENT_NAME,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    segmentId: contactSegmentId,
    stepKeys: ["start", "segment", "welcome"],
    templateAlias: TEMPLATE_ALIAS,
    templateId,
  }, null, 2));
}

const executedScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (import.meta.url === executedScript) {
  await main();
}
