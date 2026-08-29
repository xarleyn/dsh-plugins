import { z } from "zod";
import {
  DRAFT_FILE_VERSION,
  DRAFT_SESSION_VERSION,
} from "../shared/constants.js";

export const draftStateSchema = z.union([
  z.literal("draft"),
  z.literal("materializing"),
  z.literal("ready"),
  z.literal("converting"),
  z.literal("error"),
]);

export const draftSessionSchema = z.strictObject({
  version: z.literal(DRAFT_SESSION_VERSION),
  id: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  workspaceId: z.string().min(1),
  workspacePath: z.string().min(1).optional(),
  text: z.string(),
  title: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  pinned: z.boolean().optional(),
  agentPresetId: z.string().min(1).optional(),
  state: draftStateSchema,
  lastError: z.string().min(1).optional(),
  revision: z.number().int().positive(),
});

export const draftFileSchema = z.strictObject({
  version: z.literal(DRAFT_FILE_VERSION),
  drafts: z.array(draftSessionSchema),
});
