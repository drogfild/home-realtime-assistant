import { z } from 'zod';

export type ToolHandler = (args: unknown) => Promise<unknown>;

export type ToolDefinition = {
  name: string;
  schema: z.ZodTypeAny;
  handler: ToolHandler;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};
