import { describe, expect, it } from "vitest";

import gamesFixture from "../test/fixtures/games.json";
import tierListGamesFixture from "../test/fixtures/tier-list-games.json";
import { csvDataUri, gamesToCsv, omnibusGamesToCsv, tierListToCsv } from "./csv";

type GamesInput = Parameters<typeof gamesToCsv>[0];
type TierInput = Parameters<typeof tierListToCsv>[0];

describe("CSV exports", () => {
  it("writes the game header and fixture rows", () => {
    const csv = gamesToCsv(gamesFixture as GamesInput);
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "title,slug,release_year,game_status,player_status,engines,genres,developers",
    );
    expect(lines[1]).toContain('"Alpha, The Beginning"');
    expect(lines[1]).toContain("Ren'py,Visual Novel,Example Studio");
    expect(lines[2]).toBe("dev_hell,dev-hell,,unreleased,not_started,,,");
  });

  it("quotes commas, quotes, and newlines and leaves null cells empty", () => {
    const csv = gamesToCsv([{
      title: "Line 1, \"quoted\"\nLine 2",
      slug: "quoted-game",
      release_year: undefined,
    }]);

    expect(csv).toContain('"Line 1, ""quoted""\nLine 2"');
    expect(csv).toContain("quoted-game,,,,,,");
  });

  it("returns only the header for an empty game list", () => {
    expect(gamesToCsv([])).toBe(
      "title,slug,release_year,game_status,player_status,engines,genres,developers",
    );
  });

  it("adds omnibus member counts and active member titles", () => {
    const csv = omnibusGamesToCsv([{
      title: "Collection",
      slug: "collection",
      bundle_members: [
        { title: "Finished", player_status: "completed" },
        { title: "Active", player_status: "in_progress" },
        { title: "Waiting", player_status: "not_started" },
      ],
    }]);

    expect(csv.split("\n")[0]).toContain(
      "member_count,completed_member_count,in_progress_member",
    );
    expect(csv.split("\n")[1]).toBe("Collection,collection,,,,,,,3,1,Active");
  });

  it("sorts tier rows from S through U and treats a missing rating as U", () => {
    const additionalRatings: TierInput = ["B", "C", "D", "F"].map((rating, index) => ({
      rating,
      game_id: {
        title: `${rating} game`,
        slug: `${rating.toLowerCase()}-game`,
        release_year: 2020 + index,
        player_status: "completed",
      },
    }));
    const source = [...tierListGamesFixture, ...additionalRatings] as TierInput;
    const csv = tierListToCsv(source);
    const rows = csv.split("\n");

    expect(rows[0]).toBe("tier,title,slug,release_year,player_status");
    expect(rows.slice(1).map((row) => row.split(",")[0])).toEqual([
      "S",
      "A",
      "B",
      "C",
      "D",
      "F",
      "",
    ]);
    expect(rows[7]).toBe(",Unrated,unrated,,not_started");
    expect(tierListGamesFixture.map(({ id }) => id)).toEqual([301, 302, 303]);
  });

  it("encodes CSV as a data URI", () => {
    expect(csvDataUri("title\nA & B")).toBe(
      "data:text/csv;charset=utf-8,title%0AA%20%26%20B",
    );
  });
});
