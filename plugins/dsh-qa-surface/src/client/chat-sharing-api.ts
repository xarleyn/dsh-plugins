import type { createSessionControlStream } from "@deepseek-ai/dsh-api-session-controller/client";
import type { RemoteResult, RemoteStreamHandle } from "@deepseek-ai/dsh-typert-protocol";
import type * as Native from "@deepseek-ai/dsh-api-session-controller/types";
import type { QaChatAccess, QaChatAuthor, QaChatGrant, QaChatMode, QaChatJson } from "../chat-sharing/types.js";

export interface QaSharingApi {
  attachmentPath?(token: string, id: string, attachmentId: string): Promise<RemoteResult<string>>;
  access(token: string, id: string): Promise<RemoteResult<QaChatAccess>>;
  visible(token: string): Promise<RemoteResult<readonly QaChatAccess[]>>;
  grants(token: string, id: string): Promise<RemoteResult<readonly QaChatGrant[]>>;
  set(token: string, id: string, email: string, mode: QaChatMode | null): Promise<RemoteResult<readonly QaChatGrant[]>>;
}
/** Handwritten face is checked against the generated transport at package build. */
export interface QaChatWire {
  chatAudit(token: string, id: string, full: boolean): Promise<RemoteResult<QaChatJson>>;
  chatAttachmentPath(token: string, id: string, attachmentId: string): Promise<RemoteResult<string>>;
  chatAccess(token: string, id: string): ReturnType<QaSharingApi["access"]>;
  chatVisible(token: string): ReturnType<QaSharingApi["visible"]>;
  chatGrants(token: string, id: string): ReturnType<QaSharingApi["grants"]>;
  chatSetGrant(token: string, id: string, email: string, mode: QaChatMode | null): ReturnType<QaSharingApi["set"]>;
  chatAuthors(token: string, id: string): Promise<RemoteResult<readonly QaChatAuthor[]>>;
  chatList(token: string, signal?: AbortSignal): Promise<RemoteResult<Native.SessionListValue>>;
  chatSearch(token: string, request: Native.SessionSearchRequest, signal?: AbortSignal): Promise<RemoteResult<Native.SessionSearchValue>>;
  chatSelectModel(token: string, request: Native.SessionSelectModelRequest): Promise<RemoteResult<Native.SessionSelectModelValue>>;
  chatPage(token: string, request: Native.SessionPageRequest, signal?: AbortSignal): Promise<RemoteResult<Native.SessionPage>>;
  chatFollow(token: string, request: Native.SessionFollowRequest, signal?: AbortSignal): RemoteStreamHandle<Native.SessionFollowFrame, never>;
  chatControl(token: string, signal?: AbortSignal): RemoteStreamHandle<Native.SessionControlFrame, never>;
  chatProjections(token: string, id: string, signal?: AbortSignal): Promise<RemoteResult<Native.SessionProjectionsValue>>;
  chatPrompt(token: string, request: Native.SessionPromptRequest, signal?: AbortSignal): Promise<RemoteResult<Native.SessionPromptValue>>;
  chatAttachment(token: string, request: Native.SessionAttachmentRequest): Promise<RemoteResult<Native.SessionAttachmentValue>>;
  chatRename(token: string, request: Native.SessionRenameRequest): Promise<RemoteResult<Native.SessionRenameValue>>;
  chatCancel(token: string, id: string): Promise<RemoteResult<Native.SessionCancelValue>>;
  chatUpdateQueue(token: string, request: Native.SessionUpdateQueueRequest): Promise<RemoteResult<Native.SessionUpdateQueueValue>>;
}
export type QaSessionRemotes = Parameters<typeof createSessionControlStream>[0];
