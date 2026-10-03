#!/usr/bin/env node

// Build gate that replaces a bare `npm audit`. It fails on every advisory
// except the explicitly listed ones below, so the severity threshold is never
// lowered and any NEW advisory (or a fix becoming available for a listed one)
// is still surfaced.
//
// Usage: npm audit --json | node audit-gate.mjs

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Advisories with no patched release, reviewed and accepted. Remove an entry
// as soon as a fixed version exists upstream.
//
// GHSA-ch52-4w7c-c8xp: http-cache-semantics <= 4.2.0 (no patched version;
// upstream issue kornelski/http-cache-semantics#56 is open). Reached only via
// astro's build-time remote-image fetching; this site is a static build with
// no shared server-side HTTP cache, so cross-user cache disclosure does not apply.
export const ACCEPTED_ADVISORIES = ["GHSA-ch52-4w7c-c8xp"];

const advisoryId = (via) => via.url?.split("/").pop();

// A vulnerability blocks the build if any advisory attached to it is not
// accepted, or if it is only a pass-through (string `via`) to a blocking one.
export const findBlocking = (report, accepted = ACCEPTED_ADVISORIES) => {
  const vulns = report.vulnerabilities ?? {};
  const memo = new Map();

  const isBlocking = (name, seen = new Set()) => {
    if (memo.has(name)) return memo.get(name);
    if (seen.has(name)) return false;
    seen.add(name);
    const vuln = vulns[name];
    const blocking = (vuln?.via ?? []).some((via) =>
      typeof via === "string"
        ? isBlocking(via, seen)
        : !accepted.includes(advisoryId(via)),
    );
    memo.set(name, blocking);
    return blocking;
  };

  return Object.keys(vulns).filter((name) => isBlocking(name));
};

const main = () => {
  const report = JSON.parse(readFileSync(0, "utf8"));
  const blocking = findBlocking(report);
  if (blocking.length === 0) {
    console.log(
      `npm audit gate passed (accepted advisories: ${ACCEPTED_ADVISORIES.join(", ")})`,
    );
    return 0;
  }
  console.error(`npm audit gate FAILED: ${blocking.join(", ")}`);
  for (const name of blocking) {
    for (const via of report.vulnerabilities[name].via) {
      if (typeof via !== "string") console.error(`  ${name}: ${via.title} - ${via.url}`);
    }
  }
  return 1;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
