#!/usr/bin/env node
import { resolveTxt } from "node:dns/promises";

/**
 * Checks the DNS a sending domain needs before Mailjet mail will be trusted.
 *
 *   node scripts/check-email-dns.mjs yourchurch.example [--selector mailjet]
 *
 * Three records, each a TXT lookup:
 *
 *   SPF    yourchurch.example           v=spf1 include:spf.mailjet.com ~all
 *   DKIM   mailjet._domainkey.<domain>  k=rsa; p=<public key Mailjet shows you>
 *   DMARC  _dmarc.<domain>              v=DMARC1; p=none|quarantine|reject; rua=mailto:…
 *
 * Exits non-zero when anything required is missing, so it can gate a deploy.
 * It cannot confirm that the DKIM key *matches* the one Mailjet holds — only
 * that a key is published under the selector Mailjet uses; the match is
 * confirmed in Mailjet's sender-domain page, which is the last step of the
 * runbook.
 */
const [, , domainArg, ...rest] = process.argv;
if (!domainArg || domainArg.startsWith("-")) {
  console.error("usage: node scripts/check-email-dns.mjs <domain> [--selector mailjet]");
  process.exit(2);
}
const domain = domainArg.replace(/\.$/, "").toLowerCase();
const selector = rest.includes("--selector") ? rest[rest.indexOf("--selector") + 1] : "mailjet";

async function txt(name) {
  try {
    const records = await resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch (error) {
    if (error?.code === "ENOTFOUND" || error?.code === "ENODATA") return [];
    throw error;
  }
}

const results = [];
function report(name, ok, detail, required = true) {
  results.push({ name, ok, detail, required });
  const mark = ok ? "PASS" : required ? "FAIL" : "WARN";
  console.log(`${mark.padEnd(5)} ${name.padEnd(6)} ${detail}`);
}

// --- SPF ------------------------------------------------------------------
const spf = (await txt(domain)).filter((record) => /^v=spf1\b/i.test(record));
if (spf.length === 0) {
  report("SPF", false, `no v=spf1 record on ${domain}`);
} else if (spf.length > 1) {
  report("SPF", false, `${spf.length} v=spf1 records on ${domain}; receivers treat more than one as a permanent error`);
} else {
  const record = spf[0];
  const includesMailjet = /include:spf\.mailjet\.com/i.test(record);
  const lookups = (record.match(/\b(include|a|mx|ptr|exists|redirect)[:=]?/gi) ?? []).length;
  report("SPF", includesMailjet, includesMailjet ? record : `${record} — missing include:spf.mailjet.com`);
  if (lookups > 10) report("SPF", false, `${lookups} DNS-lookup mechanisms; the limit is 10`);
  if (/\+all\b/i.test(record)) report("SPF", false, "+all lets anybody send as you; use ~all or -all");
}

// --- DKIM -----------------------------------------------------------------
const dkimName = `${selector}._domainkey.${domain}`;
const dkim = (await txt(dkimName)).filter((record) => /(^|;)\s*p=/i.test(record) || /v=DKIM1/i.test(record));
if (dkim.length === 0) {
  report("DKIM", false, `no key at ${dkimName}`);
} else {
  const record = dkim[0];
  const key = record.match(/\bp=([^;]*)/i)?.[1]?.replace(/\s+/g, "") ?? "";
  if (!key) report("DKIM", false, `${dkimName} has an empty p= (a revoked key)`);
  else report("DKIM", true, `${dkimName} publishes a ${Math.round((key.length * 6) / 8)}-byte key`);
}

// --- DMARC ----------------------------------------------------------------
const dmarcName = `_dmarc.${domain}`;
const dmarc = (await txt(dmarcName)).filter((record) => /^v=DMARC1\b/i.test(record));
if (dmarc.length === 0) {
  report("DMARC", false, `no v=DMARC1 record at ${dmarcName}`);
} else {
  const record = dmarc[0];
  const policy = record.match(/\bp=(none|quarantine|reject)/i)?.[1]?.toLowerCase();
  const rua = /\brua=mailto:/i.test(record);
  report("DMARC", Boolean(policy), policy ? `${dmarcName}: p=${policy}` : `${record} — no p= policy`);
  if (policy === "none") report("DMARC", false, "p=none only monitors; move to quarantine or reject once reports are clean", false);
  if (!rua) report("DMARC", false, "no rua= address, so you will get no aggregate reports", false);
}

// --- Summary --------------------------------------------------------------
const failed = results.filter((entry) => !entry.ok && entry.required);
console.log("");
if (failed.length) {
  console.log(`${failed.length} required check(s) failed for ${domain}.`);
  process.exit(1);
}
console.log(`DNS looks right for ${domain}. Confirm the domain shows as validated in Mailjet → Senders & Domains.`);
