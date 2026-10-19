import { describe, expect, it } from "vitest";

import { fieldChoiceStaticPaths } from "./field-options";

describe("Directus field choice routes", () => {
  it("creates labeled routes for every configured choice, including unused values", () => {
    expect(fieldChoiceStaticPaths([
      { value: "in_progress", label: "Currently Playing" },
      { value: "waiting_for_update", label: "Waiting for Update" },
    ], "slug")).toEqual([
      { params: { slug: "in_progress" }, props: { label: "Currently Playing" } },
      { params: { slug: "waiting_for_update" }, props: { label: "Waiting for Update" } },
    ]);
  });
});
