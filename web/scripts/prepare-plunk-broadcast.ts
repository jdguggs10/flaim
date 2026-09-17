#!/usr/bin/env node

import { render } from "@react-email/render";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as React from "react";

import {
  definePlunkBroadcast,
  plunkUnsubscribeUrl,
  type PlunkBroadcastManifest,
} from "../emails/broadcast-manifest";
import { htmlToText } from "./export-email-text.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(webDirectory, ".email-out");
const resendUnsubscribePattern = /\{\{\{?\s*RESEND_UNSUBSCRIBE_URL\s*\}?\}\}/i;
const plunkUnsubscribeLinkPattern = new RegExp(
  `<a\\b[^>]*href=["']${escapeRegExp(plunkUnsubscribeUrl)}["'][^>]*>[\\s\\S]*?unsubscribe[\\s\\S]*?<\\/a>`,
  "i",
);

export type PlunkBroadcastExport = {
  html: string;
  manifest: Omit<PlunkBroadcastManifest, "template">;
  text: string;
};

export function validatePlunkBroadcastHtml(
  html: string,
  manifest: PlunkBroadcastManifest,
): void {
  if (resendUnsubscribePattern.test(html)) {
    throw new Error("Plunk export contains a Resend unsubscribe token");
  }

  if (!plunkUnsubscribeLinkPattern.test(html)) {
    throw new Error(
      "Plunk export must include a visible Unsubscribe link using {{unsubscribeUrl}}",
    );
  }

  const flaimLinks = extractFlaimLinks(html);

  for (const link of flaimLinks) {
    if (link.protocol !== "https:") {
      throw new Error(`Flaim link ${link.href} must use https`);
    }

    if (link.searchParams.get("ref") !== manifest.ref) {
      throw new Error(
        `Flaim link ${link.pathname} is missing the expected ref=${manifest.ref}`,
      );
    }
  }

  for (const expectedPath of manifest.expectedFlaimPaths) {
    if (!flaimLinks.some((link) => link.pathname === expectedPath)) {
      throw new Error(`Plunk export is missing the expected Flaim link ${expectedPath}`);
    }
  }
}

export function validatePlunkBroadcastText(text: string): void {
  const unsubscribeTextPattern = new RegExp(
    `unsubscribe[\\s\\S]*?${escapeRegExp(plunkUnsubscribeUrl)}`,
    "i",
  );

  if (!unsubscribeTextPattern.test(text)) {
    throw new Error(
      "Plunk plain-text export must include a visible Unsubscribe link using {{unsubscribeUrl}}",
    );
  }
}

export async function preparePlunkBroadcast(
  manifest: PlunkBroadcastManifest,
): Promise<PlunkBroadcastExport> {
  definePlunkBroadcast(manifest);

  const html = await render(
    React.createElement(manifest.template, { unsubscribeUrl: plunkUnsubscribeUrl }),
  );
  validatePlunkBroadcastHtml(html, manifest);
  const text = htmlToText(html);
  validatePlunkBroadcastText(text);

  return {
    html,
    manifest: {
      audience: manifest.audience,
      expectedFlaimPaths: manifest.expectedFlaimPaths,
      from: manifest.from,
      fromName: manifest.fromName,
      id: manifest.id,
      name: manifest.name,
      preview: manifest.preview,
      ref: manifest.ref,
      releaseGate: manifest.releaseGate,
      replyTo: manifest.replyTo,
      subject: manifest.subject,
      type: manifest.type,
    },
    text,
  };
}

function extractFlaimLinks(html: string): URL[] {
  const hrefPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  const links: URL[] = [];

  for (const match of html.matchAll(hrefPattern)) {
    const href = match[1].replaceAll("&amp;", "&");

    try {
      const url = new URL(href);
      if (url.hostname === "flaim.app" || url.hostname.endsWith(".flaim.app")) {
        links.push(url);
      }
    } catch {
      // Relative and provider placeholders are not Flaim-owned public links.
    }
  }

  return links;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseManifestPath(args: string[]): string {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const manifestIndex = normalizedArgs.indexOf("--manifest");
  const manifestPath = normalizedArgs[manifestIndex + 1];

  if (manifestIndex === -1 || !manifestPath || normalizedArgs.length !== 2) {
    throw new Error("Usage: pnpm email:plunk -- --manifest emails/campaigns/<campaign>.ts");
  }

  const resolvedPath = path.resolve(webDirectory, manifestPath);
  const campaignsDirectory = path.join(webDirectory, "emails", "campaigns");

  if (!resolvedPath.startsWith(`${campaignsDirectory}${path.sep}`)) {
    throw new Error("Plunk campaign manifests must live under web/emails/campaigns");
  }

  return resolvedPath;
}

async function loadManifest(manifestPath: string): Promise<PlunkBroadcastManifest> {
  const manifestModule = (await import(pathToFileURL(manifestPath).href)) as {
    default?: unknown;
  };

  if (!manifestModule.default || typeof manifestModule.default !== "object") {
    throw new Error("Plunk campaign manifest must default-export definePlunkBroadcast(...)");
  }

  return manifestModule.default as PlunkBroadcastManifest;
}

async function main() {
  const manifestPath = parseManifestPath(process.argv.slice(2));
  const manifest = await loadManifest(manifestPath);
  const prepared = await preparePlunkBroadcast(manifest);
  const campaignDirectory = path.join(outputDirectory, prepared.manifest.id);

  await mkdir(campaignDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(campaignDirectory, "plunk.html"), `${prepared.html}\n`, "utf8"),
    writeFile(path.join(campaignDirectory, "plunk.txt"), `${prepared.text}\n`, "utf8"),
    writeFile(
      path.join(campaignDirectory, "campaign.json"),
      `${JSON.stringify(prepared.manifest, null, 2)}\n`,
      "utf8",
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        campaign: prepared.manifest.id,
        output: path.relative(webDirectory, campaignDirectory),
        status: "prepared",
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
