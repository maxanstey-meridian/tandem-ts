export type RouteOutcome = "success" | "failed";

interface GroupedRoute {
  readonly id: string;
  readonly source: string;
  readonly outcome?: RouteOutcome;
}

/** Mirrors the server's `editing.insertions` keys. */
export function groupKey(source: string, outcome: RouteOutcome | null | undefined): string {
  return `${source}\u0000${outcome ?? "default"}`;
}

/** Position of a route among the routes sharing its source and outcome. */
export function outgoingOrder(routes: readonly GroupedRoute[], route: GroupedRoute): number {
  return routes
    .filter((candidate) => candidate.source === route.source && candidate.outcome === route.outcome)
    .findIndex((candidate) => candidate.id === route.id);
}

export function sourceLocation(
  value: { readonly file?: string; readonly line?: number } | undefined,
) {
  return value?.file ? `${value.file}:${value.line}` : "Source location unavailable";
}
