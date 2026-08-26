import type { AstroIntegration } from "astro";

import {
  logDirectusFetchSummary,
  setBuildMetricsEnabled,
} from "../lib/build-metrics";

export default function buildMetricsIntegration(): AstroIntegration {
  return {
    name: "jasmeralia-build-metrics",
    hooks: {
      "astro:config:setup": ({ command }) => {
        if (command === "build") {
          setBuildMetricsEnabled(true);
        }
      },
      "astro:build:done": async () => {
        logDirectusFetchSummary();
      },
    },
  };
}
