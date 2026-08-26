#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROUTE_TIMING_RE = /[├└]─\s+(\S+)\s+\(\+(\d+)ms\)/;

export const parseRouteTimings = (lines) => {
  const routes = [];
  for (const line of lines) {
    const match = line.match(ROUTE_TIMING_RE);
    if (!match) continue;
    routes.push({
      route: match[1],
      durationMs: Number(match[2]),
    });
  }
  return routes;
};

export const summarizeRouteTimings = (routes, topN = 15) => {
  const slowest = [...routes]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, topN);
  return {
    count: routes.length,
    totalMs: routes.reduce((sum, route) => sum + route.durationMs, 0),
    slowest,
  };
};

export const logRouteTimingSummary = (lines, topN = 15) => {
  const summary = summarizeRouteTimings(parseRouteTimings(lines), topN);
  if (summary.count === 0) {
    console.log("[timing] route_summary pages=0 total_ms=0");
    return summary;
  }

  console.log(
    `[timing] route_summary pages=${summary.count} total_ms=${summary.totalMs}`,
  );
  for (const route of summary.slowest) {
    console.log(
      `[timing] route_slow path=${route.route} duration_ms=${route.durationMs}`,
    );
  }
  return summary;
};

const main = () => {
  const sourcePath = process.argv[2];
  const text = sourcePath
    ? readFileSync(sourcePath, "utf8")
    : readFileSync(0, "utf8");
  logRouteTimingSummary(text.split(/\r?\n/));
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main();
}
