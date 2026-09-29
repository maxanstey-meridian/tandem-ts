import { z } from "zod";

const StudioEnvSchema = z
  .object({
    TANDEM_STUDIO_CWD: z.string().min(1).optional(),
    TANDEM_STUDIO_CONFIG: z.string().min(1).optional(),
    TANDEM_STUDIO_LOADER_CHILD: z.string().min(1).optional(),
    TANDEM_STUDIO_EDITOR: z
      .string()
      .regex(/^\S+$/, "TANDEM_STUDIO_EDITOR must be an executable name or path without arguments.")
      .optional(),
  })
  .transform((env) => ({
    cwd: env.TANDEM_STUDIO_CWD ?? process.cwd(),
    config: env.TANDEM_STUDIO_CONFIG,
    loaderChild: env.TANDEM_STUDIO_LOADER_CHILD,
    editor: env.TANDEM_STUDIO_EDITOR,
  }));

const parsed = StudioEnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid Tandem Studio environment:\n${z.prettifyError(parsed.error)}`);
}
export const studioEnv = parsed.data;

export function studioServerEnvironment(values: {
  readonly cwd: string;
  readonly config: string;
  readonly loaderChild: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TANDEM_STUDIO_CWD: values.cwd,
    TANDEM_STUDIO_CONFIG: values.config,
    TANDEM_STUDIO_LOADER_CHILD: values.loaderChild,
  };
}
