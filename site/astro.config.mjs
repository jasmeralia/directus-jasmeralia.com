import { defineConfig } from "astro/config";
import buildMetricsIntegration from "./src/integrations/build-metrics.ts";

export default defineConfig({
  site: "http://localhost:4321",
  integrations: [buildMetricsIntegration()],
});
