import type { Discipline } from "./types";

export function disciplinePathValue(
  discipline: Pick<Discipline, "id" | "slug"> | null | undefined,
  fallback = "",
) {
  return discipline?.slug || discipline?.id || fallback;
}

export function matchesDisciplineIdentifier(
  discipline: Pick<Discipline, "id" | "slug">,
  identifier: string,
) {
  return discipline.id === identifier || discipline.slug === identifier;
}
