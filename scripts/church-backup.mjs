#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

/**
 * Back up or restore one church through the operator endpoints.
 *
 *   CRON_SECRET=… node scripts/church-backup.mjs backup  https://host <churchId> [out.json]
 *   CRON_SECRET=… node scripts/church-backup.mjs restore https://host <churchId> in.json [--allow-different-church]
 *
 * The backup includes pastoral-care records. Keep the file somewhere
 * encrypted and delete it when it is no longer needed.
 */
const [, , command, baseUrl, churchId, file, ...flags] = process.argv;
const secret = process.env.CRON_SECRET;

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/church-backup.mjs backup|restore <baseUrl> <churchId> [file] [--allow-different-church]");
  process.exit(2);
}

if (!["backup", "restore"].includes(command) || !baseUrl || !churchId) usage();
if (!secret) usage("CRON_SECRET is not set.");

const headers = { authorization: `Bearer ${secret}` };
const base = baseUrl.replace(/\/$/, "");

if (command === "backup") {
  const response = await fetch(`${base}/api/ops/backup?church=${encodeURIComponent(churchId)}`, { headers });
  if (!response.ok) {
    console.error(`backup failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  const body = await response.text();
  const out = file ?? `gatherflow-${churchId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  // Private to the operator, and never over an existing file: a backup that
  // replaced an older backup would be a loss nobody noticed.
  await writeFile(out, body, { mode: 0o600, flag: "wx" });
  const parsed = JSON.parse(body);
  const counts = Object.entries(parsed.data)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => `${key}=${value.length}`)
    .join(" ");
  console.log(`wrote ${out} (version ${parsed.version}; ${counts})`);
} else {
  if (!file) usage("restore needs a file.");
  const body = await readFile(file, "utf8");
  const allow = flags.includes("--allow-different-church") ? "&allowDifferentChurch=1" : "";
  const response = await fetch(`${base}/api/ops/restore?church=${encodeURIComponent(churchId)}${allow}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`restore failed: ${response.status} ${text}`);
    process.exit(1);
  }
  console.log(`restored: ${text}`);
}
