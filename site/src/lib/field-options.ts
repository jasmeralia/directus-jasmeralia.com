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
