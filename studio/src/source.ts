import {
  Project,
  Node,
  QuoteKind,
  type CallExpression,
  type ObjectLiteralExpression,
} from "ts-morph";
import { z } from "zod";
import { pipelineDeclarations } from "./ownership.js";

const RouteOutcomeSchema = z.enum(["success", "failed"]);

export const RouteEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("delete"), order: z.number().int().nonnegative() }),
  z.strictObject({
    kind: z.literal("move"),
    order: z.number().int().nonnegative(),
    toOrder: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("update"),
    order: z.number().int().nonnegative(),
    from: z.string().optional(),
    to: z.string().optional(),
    label: z.string().optional(),
    outcome: RouteOutcomeSchema.nullable().optional(),
    when: z.string().nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal("insert"),
    order: z.number().int().nonnegative(),
    from: z.string(),
    to: z.string(),
    label: z.string(),
    outcome: RouteOutcomeSchema.optional(),
    when: z.string().optional(),
  }),
]);
export type RouteEdit = z.infer<typeof RouteEditSchema>;

export async function editDirectRoute(
  file: string,
  pipelineName: string,
  edit: RouteEdit,
): Promise<string> {
  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Double },
    tsConfigFilePath: undefined,
  });
  const source = project.addSourceFileAtPath(file);
  const arrays = pipelineDeclarations([source], pipelineName)
    .map((object) => object.getProperty("routes"))
    .filter(Node.isPropertyAssignment)
    .map((property) => property.getInitializer())
    .filter(Node.isArrayLiteralExpression);
  const [array] = arrays;
  if (!array || arrays.length !== 1) {
    throw new Error(
      "Routes are read-only: a single direct pipeline routes array could not be identified.",
    );
  }
  if (edit.kind === "insert") {
    const properties = [
      `from: ${edit.from}`,
      `to: ${edit.to}`,
      `label: ${JSON.stringify(edit.label)}`,
    ];
    if (edit.outcome) {
      properties.push(`outcome: ${JSON.stringify(edit.outcome)}`);
    }
    if (edit.when) {
      properties.push(`when: ${edit.when}`);
    }
    array.insertElement(edit.order, `route({ ${properties.join(", ")} })`);
  } else {
    const element = array.getElements()[edit.order];
    if (
      !Node.isCallExpression(element) ||
      element.getExpression().getText() !== "route" ||
      !Node.isObjectLiteralExpression(element.getArguments()[0])
    ) {
      throw new Error(`Direct route ${edit.order} is helper-generated or ambiguous.`);
    }
    const call = element;
    if (edit.kind === "delete") {
      array.removeElement(edit.order);
    } else if (edit.kind === "move") {
      const text = call.getText();
      array.removeElement(edit.order);
      array.insertElement(edit.toOrder, text);
    } else {
      update(call, edit);
    }
  }
  await source.formatText();
  return source.getFullText();
}
function update(call: CallExpression, edit: Extract<RouteEdit, { kind: "update" }>): void {
  const object = call.getArguments()[0] as ObjectLiteralExpression;
  const set = (name: string, value: string | null | undefined) => {
    if (value === undefined) {
      return;
    }
    const existing = object.getProperty(name);
    if (value === null) {
      existing?.remove();
    } else if (existing && Node.isPropertyAssignment(existing)) {
      existing.setInitializer(value);
    } else {
      object.addPropertyAssignment({ name, initializer: value });
    }
  };
  set("from", edit.from);
  set("to", edit.to);
  set("label", edit.label === undefined ? undefined : JSON.stringify(edit.label));
  set(
    "outcome",
    edit.outcome === undefined
      ? undefined
      : edit.outcome === null
        ? null
        : JSON.stringify(edit.outcome),
  );
  set("when", edit.when);
}
