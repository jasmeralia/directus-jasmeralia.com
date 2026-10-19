import { describe, expect, it } from "vitest";

import { fieldChoiceStaticPaths, sectionStyleStaticPaths } from "./field-options";

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

  it("builds section-style paths with built-in and generated descriptions", () => {
    expect(sectionStyleStaticPaths([
      { value: "linear", label: "Ordered" },
      { value: "mission_pool", label: "Mission Pool" },
    ])).toEqual([
      {
        params: { style: "linear" },
        props: {
          label: "Ordered",
          description: "Games tracked with an ordered chapter/act/episode model.",
        },
      },
      {
        params: { style: "mission_pool" },
        props: {
          label: "Mission Pool",
          description: "Games tracked with the mission pool section model.",
        },
      },
    ]);
  });
});
