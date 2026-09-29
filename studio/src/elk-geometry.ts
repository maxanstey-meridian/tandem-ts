import type { ElkEdgeSection, ElkNode, ElkPoint } from "elkjs";

const sectionPoints = (section: ElkEdgeSection): ElkPoint[] => [
  section.startPoint,
  ...(section.bendPoints ?? []),
  section.endPoint,
];

function routedMidpoint(sections: readonly ElkEdgeSection[]): ElkPoint | undefined {
  const segments = sections.flatMap((section) => {
    const points = sectionPoints(section);
    return points.slice(1).flatMap((end, index) => {
      const start = points[index];
      return start ? [{ start, end, length: Math.hypot(end.x - start.x, end.y - start.y) }] : [];
    });
  });
  const last = segments.at(-1);
  if (!last) {
    return undefined;
  }
  let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  for (const { start, end, length } of segments) {
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    remaining -= length;
  }
  return { x: last.end.x, y: last.end.y };
}

export function mapElkLayout(result: ElkNode) {
  const positions = Object.fromEntries(
    (result.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]),
  );
  const edgePaths = Object.fromEntries(
    (result.edges ?? []).flatMap((edge) => {
      const sections = edge.sections ?? [];
      if (!sections.length) {
        return [];
      }
      const path = sections
        .map((section) =>
          sectionPoints(section)
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" "),
        )
        .join(" ");
      return [[edge.id, path] as const];
    }),
  );
  const edgeAnchors = Object.fromEntries(
    (result.edges ?? []).flatMap((edge) => {
      const anchor = routedMidpoint(edge.sections ?? []);
      return anchor ? [[edge.id, anchor] as const] : [];
    }),
  );
  return { positions, edgePaths, edgeAnchors };
}
