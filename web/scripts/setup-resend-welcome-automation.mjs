#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";

const EVENT_NAME = "flaim.user_created";
const TEMPLATE_ALIAS = "flaim-welcome-v1";
const TEMPLATE_NAME = "Flaim Welcome";
const AUTOMATION_NAME = "Flaim Welcome Email";
const EVENT_SCHEMA_VERSION = "2026-06-09-given-name";
const RESEND_PROPAGATION_DELAY_MS = 300;
const MAX_TEMPLATE_LIST_PAGES = 20;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const emailLinks = JSON.parse(
  readFileSync(join(scriptDir, "../emails/flaim-email-links.json"), "utf8"),
);
const CHATGPT_APP_URL = emailLinks.chatGptAppUrl;
const LEAGUES_URL = emailLinks.leaguesUrl;
const CONTACT_SEGMENT_ID = process.env.RESEND_CONTACT_SEGMENT_ID?.trim();

const apiKey = process.env.RESEND_EVENTS_API_KEY ?? process.env.RESEND_CONTACTS_API_KEY;

if (!apiKey) {
  throw new Error("RESEND_EVENTS_API_KEY or RESEND_CONTACTS_API_KEY is required");
}

if (!CONTACT_SEGMENT_ID) {
  throw new Error("RESEND_CONTACT_SEGMENT_ID is required");
}

const resend = new Resend(apiKey);

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

async function ensureEvent() {
  const events = assertSuccess(await resend.events.list(), "List Resend events");
  const existing = events.data.find((event) => event.name === EVENT_NAME);
  const schema = {
    clerk_user_id: "string",
    given_name: "string",
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

function buildWelcomeHtml() {
  // This mirrors web/emails/welcome.tsx for Resend Automations, which are
  // managed through Resend's API. Update both when changing the welcome email.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f9fafb;color:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">Connect a league to start using Flaim with your AI assistant.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
            <tr>
              <td style="padding:0 0 16px 0;">
                <a href="https://flaim.app" style="text-decoration:none;"><img alt="" src="https://flaim.app/flaim-email-mark.png" width="32" height="32" style="display:inline-block;margin:0 8px 0 0;vertical-align:middle;" /></a><a href="https://flaim.app" style="color:#030712;display:inline-block;font-size:18px;font-weight:700;line-height:24px;margin:0;text-decoration:none;vertical-align:middle;">Flaim</a>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
                <p style="margin:0 0 10px 0;font-size:12px;line-height:18px;font-weight:700;color:#6b7280;">WELCOME</p>
                <h1 style="margin:0 0 18px 0;font-size:24px;line-height:32px;font-weight:700;color:#030712;">Connect your first league</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#030712;">Hi {{{GIVEN_NAME}}},</p>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#030712;">Flaim lets you ask fantasy questions using your real league data, including your roster, standings, matchups, and transactions. Once connected, you can ask about waiver adds, trade ideas, roster decisions, and league trends.</p>
                <div style="margin:8px 0 20px;padding:16px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;">
                  <p style="margin:0 0 12px 0;font-size:14px;line-height:22px;font-weight:700;color:#030712;">Finish your setup</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;width:100%;">
                    <tr>
                      <td style="padding:0;vertical-align:middle;width:33.333%;"><div style="background:#22c55e;border-radius:999px 0 0 999px;height:6px;width:100%;"></div></td>
                      <td style="padding:0;vertical-align:middle;width:33.333%;"><div style="background:#e5e7eb;height:6px;width:100%;"></div></td>
                      <td style="padding:0;vertical-align:middle;width:33.333%;"><div style="background:#e5e7eb;border-radius:0 999px 999px 0;height:6px;width:100%;"></div></td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                    <tr>
                      <td style="padding:0 6px 0 0;vertical-align:top;width:33.333%;">
                        <p style="margin:0;color:#166534;font-size:11px;font-weight:700;line-height:16px;text-transform:uppercase;">Done</p>
                        <p style="margin:2px 0 0;color:#030712;font-size:12px;line-height:17px;">Account</p>
                      </td>
                      <td style="padding:0 6px;vertical-align:top;width:33.333%;">
                        <p style="margin:0;color:#030712;font-size:11px;font-weight:700;line-height:16px;text-transform:uppercase;">Next</p>
                        <a href="${LEAGUES_URL}" style="color:#030712;font-size:12px;font-weight:700;line-height:17px;text-decoration:underline;">Connect a league →</a>
                      </td>
                      <td style="padding:0 0 0 6px;vertical-align:top;width:33.333%;">
                        <p style="margin:0;color:#6b7280;font-size:11px;font-weight:700;line-height:16px;text-transform:uppercase;">Then</p>
                        <a href="${CHATGPT_APP_URL}" style="color:#6b7280;font-size:12px;font-weight:700;line-height:17px;text-decoration:underline;">Open in ChatGPT →</a>
                      </td>
                    </tr>
                  </table>
                </div>
                <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:21px;color:#6b7280;">Flaim is read-only. It can access your league data, but it cannot set lineups, drop players, make trades, or change league settings.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 4px 0;color:#6b7280;font-size:12px;line-height:18px;">
                <p style="margin:0 0 8px 0;">You are receiving this because you created a Flaim account. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#030712;text-decoration:underline;">Unsubscribe</a>.</p>
                <p style="margin:0 0 8px 0;">Need help? Email <a href="mailto:support@flaim.app" style="color:#030712;text-decoration:underline;">support@flaim.app</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildWelcomeText() {
  // Resend template variables use triple braces.
  return `Welcome to Flaim

Hi {{{GIVEN_NAME}}},

Flaim lets you ask fantasy questions using your real league data, including your roster, standings, matchups, and transactions. Once connected, you can ask about waiver adds, trade ideas, roster decisions, and league trends.

Finish your setup:

DONE: Account
NEXT: Connect a league: ${LEAGUES_URL}
THEN: Open in ChatGPT: ${CHATGPT_APP_URL}

Flaim is read-only. It can access your league data, but it cannot set lineups, drop players, make trades, or change league settings.

Need help? Email support@flaim.app.
Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}`;
}

async function ensureTemplate() {
  const payload = {
    alias: TEMPLATE_ALIAS,
    from: "Flaim <updates@flaim.app>",
    html: buildWelcomeHtml(),
    name: TEMPLATE_NAME,
    replyTo: "support@flaim.app",
    subject: "Welcome to Flaim",
    text: buildWelcomeText(),
    variables: [
      {
        fallbackValue: "there",
        key: "GIVEN_NAME",
        type: "string",
      },
    ],
  };
  const existing = await findTemplateByAlias(TEMPLATE_ALIAS);

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

async function findTemplateByAlias(alias) {
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

function buildAutomation(templateId) {
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
          segmentId: CONTACT_SEGMENT_ID,
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
            variables: {
              // Coupled to the event payload in resend-welcome-automation.ts.
              GIVEN_NAME: { var: "event.given_name" },
            },
          },
        },
      },
    ],
  };
}

async function ensureAutomation(templateId) {
  const automations = assertSuccess(
    await resend.automations.list(),
    "List Resend automations",
  );
  const payload = buildAutomation(templateId);
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

const eventId = await ensureEvent();
// Resend's management API can briefly lag between dependent resource writes.
await sleep(RESEND_PROPAGATION_DELAY_MS);
const templateId = await ensureTemplate();
await sleep(RESEND_PROPAGATION_DELAY_MS);
const automationId = await ensureAutomation(templateId);

console.log(JSON.stringify({
  automationId,
  automationStatus: "disabled",
  // Informational only. The automation binds to the event by name.
  eventId,
  eventName: EVENT_NAME,
  eventSchemaVersion: EVENT_SCHEMA_VERSION,
  segmentId: CONTACT_SEGMENT_ID,
  stepKeys: ["start", "segment", "welcome"],
  templateAlias: TEMPLATE_ALIAS,
  templateId,
}, null, 2));
