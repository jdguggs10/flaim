#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toPlainText } from "@react-email/render";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(webDirectory, ".email-out");

export function htmlToText(html) {
  return toPlainText(html, { wordwrap: false }).trim();
}

function runEmailExport() {
  const emailCli = path.join(webDirectory, "node_modules", ".bin", "email");

  return new Promise((resolve, reject) => {
    const child = spawn(
      emailCli,
      ["export", "--dir", "emails", "--outDir", ".email-out", "--pretty"],
      { cwd: webDirectory, stdio: "inherit" },
    );

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`React Email export failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function writeTextFallbacks() {
  const exports = await readdir(outputDirectory, { withFileTypes: true });
  const htmlFiles = exports.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".html"),
  );

  await Promise.all(
    htmlFiles.map(async (file) => {
      const htmlPath = path.join(outputDirectory, file.name);
      const textPath = path.join(outputDirectory, file.name.replace(/\.html$/, ".txt"));
      const html = await readFile(htmlPath, "utf8");
      await writeFile(textPath, `${htmlToText(html)}\n`, "utf8");
    }),
  );
}

async function main() {
  await runEmailExport();
  await writeTextFallbacks();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
