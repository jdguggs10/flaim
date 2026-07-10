#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resend } from "resend";

function printUsage() {
  console.log(`
Create a Resend broadcast draft from exported HTML.

Required:
  --segment-id <id>      Resend segment to target
  --subject <subject>    Broadcast subject line

Optional:
  --api-key <key>        Resend API key. Defaults to RESEND_API_KEY.
  --broadcast-id <id>    Existing draft to update instead of creating a new one
  --from <sender>        Defaults to Flaim <updates@flaim.app>
  --reply-to <address>   Defaults to support@flaim.app
  --name <name>          Internal broadcast name
  --template <name>      Template basename; defaults HTML path to .email-out/<name>.html
  --html-file <path>     Exported HTML file from \`corepack pnpm --dir web run email:export\`
  --text-file <path>     Plain-text body. If omitted, Resend derives text from HTML.
  --send                 Send immediately after creation
  --scheduled-at <when>  Natural language or ISO timestamp. Requires --send.
  --help                 Show this help text

Examples:
  node scripts/create-resend-broadcast.mjs \\
    --template marketing-broadcast \\
    --segment-id segment_123 \\
    --subject "Product update"

  node scripts/create-resend-broadcast.mjs \\
    --template marketing-broadcast \\
    --segment-id segment_123 \\
    --subject "Product update" \\
    --send
`);
}

function parseArgs(argv) {
  const args = {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    broadcastId: null,
    from: "Flaim <updates@flaim.app>",
    htmlFile: null,
    name: null,
    template: null,
    replyTo: "support@flaim.app",
    scheduledAt: null,
    segmentId: null,
    send: false,
    subject: null,
    textFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--") {
      continue;
    }

    if (arg === "--api-key" && next) {
      args.apiKey = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--broadcast-id" && next) {
      args.broadcastId = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--from" && next) {
      args.from = next;
      index += 1;
      continue;
    }

    if (arg === "--html-file" && next) {
      args.htmlFile = next;
      index += 1;
      continue;
    }

    if (arg === "--name" && next) {
      args.name = next;
      index += 1;
      continue;
    }

    if (arg === "--template" && next) {
      args.template = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--reply-to" && next) {
      args.replyTo = next;
      index += 1;
      continue;
    }

    if (arg === "--scheduled-at" && next) {
      args.scheduledAt = next;
      index += 1;
      continue;
    }

    if (arg === "--segment-id" && next) {
      args.segmentId = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--send") {
      args.send = true;
      continue;
    }

    if (arg === "--subject" && next) {
      args.subject = next;
      index += 1;
      continue;
    }

    if (arg === "--text-file" && next) {
      args.textFile = next;
      index += 1;
      continue;
    }

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.apiKey) {
    throw new Error("RESEND_API_KEY or --api-key is required");
  }

  if (!args.htmlFile && !args.template) {
    throw new Error("--template or --html-file is required");
  }

  if (args.template && !args.htmlFile) {
    args.htmlFile = `.email-out/${args.template}.html`;
  }

  if (!args.htmlFile) {
    throw new Error("--html-file is required");
  }

  if (!args.segmentId) {
    throw new Error("--segment-id is required");
  }

  if (!args.subject) {
    throw new Error("--subject is required");
  }

  if (args.scheduledAt && !args.send) {
    throw new Error("--scheduled-at requires --send");
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resend = new Resend(args.apiKey);
  const htmlPath = resolve(process.cwd(), args.htmlFile);
  if (!existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`);
  }
  const html = readFileSync(htmlPath, "utf8");
  const textPath = args.textFile ? resolve(process.cwd(), args.textFile) : null;
  if (textPath && !existsSync(textPath)) {
    throw new Error(`Text file not found: ${textPath}`);
  }
  const text = textPath ? readFileSync(textPath, "utf8") : undefined;

  const payload = {
    from: args.from,
    html,
    name: args.name || args.template || undefined,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
    segmentId: args.segmentId,
    ...(args.send ? { send: true } : {}),
    subject: args.subject,
    ...(typeof text === "string" ? { text } : {}),
  };

  const { data, error } = args.broadcastId
    ? await resend.broadcasts.update(args.broadcastId, payload)
    : await resend.broadcasts.create(payload);

  if (error) {
    throw new Error(error.message ?? "Unknown Resend error");
  }

  console.log(JSON.stringify({
    broadcastId: data?.id ?? args.broadcastId ?? null,
    name: args.name,
    scheduledAt: args.scheduledAt,
    segmentId: args.segmentId,
    sent: Boolean(args.send),
    subject: args.subject,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
