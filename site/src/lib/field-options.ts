import type { DirectusFieldChoice } from "./directus";

export function fieldChoiceStaticPaths(
  choices: DirectusFieldChoice[],
  parameter: string,
) {
  return choices.map(({ value, label }) => ({
    params: { [parameter]: value },
    props: { label },
  }));
}

export function sectionStyleStaticPaths(choices: DirectusFieldChoice[]) {
  const descriptions: Record<string, string> = {
    linear: "Games tracked with an ordered chapter/act/episode model.",
    nonlinear: "Games tracked with a quest/mission pool.",
  };
  return choices.map(({ value: style, label }) => ({
    params: { style },
    props: {
      label,
      description: descriptions[style] ?? `Games tracked with the ${label.toLowerCase()} section model.`,
    },
  }));
}
