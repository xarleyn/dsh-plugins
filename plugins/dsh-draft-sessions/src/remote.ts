import { z } from "zod";
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";
import { draftSessionSchema, draftStateSchema } from "./host/schema.js";
import type {
  CreateDraftRequest,
  DeleteDraftRequest,
  DeleteDraftResult,
  DraftSession,
  ListDraftsRequest,
  RebindDraftRequest,
  UpdateDraftRequest,
} from "./shared/types.js";

const listRequestSchema = z.strictObject({
  workspaceId: z.string().min(1).optional(),
});

const createRequestSchema = z.strictObject({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1).nullable().optional(),
  workspacePath: z.string().min(1).optional(),
  text: z.string().optional(),
  title: z.string().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
  pinned: z.boolean().optional(),
  agentPresetId: z.string().min(1).optional(),
});

const updateRequestSchema = z.strictObject({
  id: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  text: z.string().optional(),
  title: z.string().min(1).nullable().optional(),
  order: z.number().int().nonnegative().optional(),
  pinned: z.boolean().optional(),
  agentPresetId: z.string().min(1).nullable().optional(),
  state: draftStateSchema.optional(),
  lastError: z.string().min(1).nullable().optional(),
});

const deleteRequestSchema = z.strictObject({
  id: z.string().min(1),
  expectedRevision: z.number().int().positive().optional(),
});

const deleteResultSchema = z.strictObject({ deleted: z.boolean() });

const rebindRequestSchema = z.strictObject({
  id: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  sessionId: z.string().min(1).nullable(),
});

function descriptor(
  method: string,
  requestType: string,
  requestSchema: z.ZodType,
  resultType: string,
  resultSchema: z.ZodType,
): InvocationDescriptor {
  return {
    id: `dsh-draft-sessions#draftSessions/${method}`,
    service: "draftSessions",
    namespace: "draftSessions",
    method,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: "request",
        wire: "request",
        source: "json",
        codec: {
          mode: "strict",
          typeSymbol: requestType,
          schema: requestSchema,
        },
      },
    ],
    result: { mode: "strict", typeSymbol: resultType, schema: resultSchema },
  };
}

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteMap {
    "draftSessions/list": (
      request: ListDraftsRequest,
    ) => Promise<RemoteResult<DraftSession[]>>;
    "draftSessions/create": (
      request: CreateDraftRequest,
    ) => Promise<RemoteResult<DraftSession>>;
    "draftSessions/update": (
      request: UpdateDraftRequest,
    ) => Promise<RemoteResult<DraftSession>>;
    "draftSessions/delete": (
      request: DeleteDraftRequest,
    ) => Promise<RemoteResult<DeleteDraftResult>>;
    "draftSessions/rebind": (
      request: RebindDraftRequest,
    ) => Promise<RemoteResult<DraftSession>>;
  }

  interface TypertRemoteNamespaceMap {
    draftSessions: TypertRemoteNamespace<"draftSessions">;
  }
}

const draftSessionsRemote = {
  package: "dsh-draft-sessions",
  descriptors: [
    descriptor(
      "list",
      "dsh-draft-sessions/types#ListDraftsRequest",
      listRequestSchema,
      "dsh-draft-sessions/types#DraftSession[]",
      z.array(draftSessionSchema),
    ),
    descriptor(
      "create",
      "dsh-draft-sessions/types#CreateDraftRequest",
      createRequestSchema,
      "dsh-draft-sessions/types#DraftSession",
      draftSessionSchema,
    ),
    descriptor(
      "update",
      "dsh-draft-sessions/types#UpdateDraftRequest",
      updateRequestSchema,
      "dsh-draft-sessions/types#DraftSession",
      draftSessionSchema,
    ),
    descriptor(
      "delete",
      "dsh-draft-sessions/types#DeleteDraftRequest",
      deleteRequestSchema,
      "dsh-draft-sessions/types#DeleteDraftResult",
      deleteResultSchema,
    ),
    descriptor(
      "rebind",
      "dsh-draft-sessions/types#RebindDraftRequest",
      rebindRequestSchema,
      "dsh-draft-sessions/types#DraftSession",
      draftSessionSchema,
    ),
  ],
} satisfies TypertRemoteContribution;

export default draftSessionsRemote;
