export type GameSection = {
  id?: number;
  number: number;
  title: string;
  bundle_member_id?: number | { id?: number } | null;
};

export const sectionNoun = (raw: string | null | undefined): string =>
  raw || "Chapter";

export const pluralizeNoun = (noun: string): string =>
  /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;

export const orderedSections = (
  sections: GameSection[] | null | undefined,
): GameSection[] =>
  (sections ?? []).slice().sort((a, b) => a.number - b.number);

export const directGameSections = (
  sections: GameSection[] | null | undefined,
): GameSection[] =>
  orderedSections(
    (sections ?? []).filter((section) => section.bundle_member_id == null),
  );

const HALF_CREDIT_STATUSES = new Set(["in_progress", "on_hold"]);

export const sectionProgressPercent = (
  current: number,
  total: number,
  playerStatus?: string | null,
): number => {
  if (playerStatus === "completed") return 100;
  if (total <= 0 || current <= 0) return 0;
  const ratio = HALF_CREDIT_STATUSES.has(playerStatus ?? "")
    ? (current - 0.5) / total
    : current / total;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

export type SectionProgressSummary = {
  label: string;
  title: string;
  percent: number;
};

export const sectionProgressSummary = (
  entry: {
    current_section?: number | null;
    section_noun?: string | null;
    player_status?: string | null;
    sections?: GameSection[] | null;
  },
  options?: { nested?: boolean },
): SectionProgressSummary | null => {
  const sections = options?.nested
    ? orderedSections(entry.sections)
    : directGameSections(entry.sections);
  const current = typeof entry.current_section === "number"
    ? entry.current_section
    : null;

  if (entry.player_status === "completed") {
    const noun = sectionNoun(entry.section_noun);
    if (current !== null && sections.length > 0) {
      return {
        label: `${noun} ${current}/${sections.length} (100%)`,
        title: `${noun} ${current} of ${sections.length}`,
        percent: 100,
      };
    }
    return {
      label: "Completed (100%)",
      title: "Completed",
      percent: 100,
    };
  }

  if (current === null || sections.length === 0) return null;

  const noun = sectionNoun(entry.section_noun);
  const percent = sectionProgressPercent(current, sections.length, entry.player_status);
  return {
    label: `${noun} ${current}/${sections.length} (${percent}%)`,
    title: `${noun} ${current} of ${sections.length}`,
    percent,
  };
};
