import { z } from "zod";

// Schema for AI-generated dashboard code
export const DashboardRuntimeCodegenSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  uiRuntimeSourceCode: z.string().min(1),
});

// Envelope for AI model output
export const DashboardRuntimeCodegenEnvelopeSchema = z.object({
  runtimeCodegen: DashboardRuntimeCodegenSchema,
});

// Schema for file selection step
export const FileSelectionResponseSchema = z.object({
  selectedFiles: z.array(z.string()),
});

// Backend API response schema
export const CreateDashboardResponseSchema = z.object({
  prompt: z.string().min(1),
  projectId: z.string().min(1),
  runtimeCodegen: DashboardRuntimeCodegenSchema,
});

// Type exports
export type DashboardRuntimeCodegen = z.infer<typeof DashboardRuntimeCodegenSchema>;
export type CreateDashboardResponse = z.infer<typeof CreateDashboardResponseSchema>;
