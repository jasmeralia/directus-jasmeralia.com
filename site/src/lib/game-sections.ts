export type GameSection = {
  id?: number;
  number: number;
  sort?: number | null;
  title: string;
  category?: string | null;
  completed?: boolean | null;
  is_ending?: boolean | null;
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

// For nonlinear games, `number` is an ordinal within its category, not a
// global position -- sorting by `number` (as `directGameSections` does)
// would interleave categories that each restart at 1. Category-grouped
// display order comes from `sort` instead, which is assigned globally
// across the whole quest list at write time.
export const directGameSectionsByPosition = (
  sections: GameSection[] | null | undefined,
): GameSection[] =>
  (sections ?? [])
    .filter((section) => section.bundle_member_id == null)
    .slice()
    .sort((a, b) => (a.sort ?? a.number) - (b.sort ?? b.number));

export type SectionCategoryGroup = {
  category: string | null;
  sections: GameSection[];
};

export const groupSectionsByCategory = (
  sections: GameSection[],
): SectionCategoryGroup[] => {
  const groups: SectionCategoryGroup[] = [];
  for (const section of sections) {
    const category = section.category ?? null;
    const last = groups[groups.length - 1];
    if (last && last.category === category) {
      last.sections.push(section);
    } else {
      groups.push({ category, sections: [section] });
    }
  }
  return groups;
};

const HALF_CREDIT_STATUSES = new Set(["in_progress", "on_hold"]);

export const sectionProgressPercent = (
  current: number,
  total: number,
  playerStatus?: string | null,
  currentSectionCompleted?: boolean,
): number => {
  if (playerStatus === "completed") return 100;
  if (total <= 0 || current <= 0) return 0;
  const halfCredit = HALF_CREDIT_STATUSES.has(playerStatus ?? "") && !currentSectionCompleted;
  const ratio = halfCredit ? (current - 0.5) / total : current / total;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

export const questProgressPercent = (
  completedCount: number,
  total: number,
  playerStatus?: string | null,
): number => {
  if (playerStatus === "completed") return 100;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completedCount / total) * 100)));
};

export type SectionProgressSummary = {
  label: string;
  title: string;
  percent: number;
};

export const sectionProgressSummary = (
  entry: {
    current_section?: number | null;
    section_style?: string | null;
    section_noun?: string | null;
    player_status?: string | null;
    sections?: GameSection[] | null;
  },
  options?: { nested?: boolean },
): SectionProgressSummary | null => {
  const sections = options?.nested
    ? orderedSections(entry.sections)
    : directGameSections(entry.sections);

  if (entry.section_style === "nonlinear") {
    const noun = sectionNoun(entry.section_noun);
    const nounPlural = pluralizeNoun(noun);
    if (entry.player_status === "completed") {
      return {
        label: `${nounPlural} completed (100%)`,
        title: `${nounPlural} completed`,
        percent: 100,
      };
    }
    if (sections.length === 0) return null;
    const completedCount = sections.filter((section) => section.completed).length;
    const percent = questProgressPercent(completedCount, sections.length, entry.player_status);
    return {
      label: `${completedCount}/${sections.length} ${nounPlural} (${percent}%)`,
      title: `${completedCount} of ${sections.length} ${nounPlural} completed`,
      percent,
    };
  }

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
  const currentSection = sections.find((section) => section.number === current);
  const percent = sectionProgressPercent(
    current,
    sections.length,
    entry.player_status,
    currentSection?.completed ?? false,
  );
  return {
    label: `${noun} ${current}/${sections.length} (${percent}%)`,
    title: `${noun} ${current} of ${sections.length}`,
    percent,
  };
};
