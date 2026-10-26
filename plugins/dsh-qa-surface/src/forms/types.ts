/** Browser-safe wire contract; storage and tool waiting have independent lifetimes. */
export interface QaFormPolicy {
  enabled: boolean;
  maxSteps: number;
  maxItemsPerForm: number;
  maxOptionsPerItem: number;
  maxSchemaBytes: number;
  maxTextLength: number;
  maxTotalAnswerBytes: number;
  maxFilesPerItem: number;
  maxFileSizeBytes: number;
  maxTotalFileBytesPerForm: number;
  maxConcurrentUploadsPerSession: number;
  uploadIntentTtlSeconds: number;
  allowedExtensions: readonly string[];
}
export interface QaFormOption {
  value: string;
  label: string;
  description?: string | undefined;
  recommended?: boolean | undefined;
}
export type QaFormAnswerSpec =
  | {
      type: "text" | "textarea";
      required: boolean;
      placeholder?: string | undefined;
      min_length?: number | undefined;
      max_length?: number | undefined;
    }
  | {
      type: "single_select" | "multi_select";
      required: boolean;
      options: QaFormOption[];
      allow_other?: boolean | undefined;
      min_selected?: number | undefined;
      max_selected?: number | undefined;
    };
export type QaFormFilesSpec =
  | { requirement: "none" }
  | {
      requirement: "required";
      min_count: number;
      max_count: number;
      accept: string[];
      max_file_size_bytes: number;
    }
  | {
      requirement: "optional";
      max_count: number;
      accept: string[];
      max_file_size_bytes: number;
    };
export interface QaFormItem {
  id: string;
  title: string;
  description?: string | undefined;
  answer?: QaFormAnswerSpec | undefined;
  files: QaFormFilesSpec;
}
export interface QaFormStep {
  id: string;
  title: string;
  description?: string | undefined;
  items: QaFormItem[];
}
export interface QaFormSchema {
  schema_version: 1;
  title: string;
  description?: string | undefined;
  submit_label?: string | undefined;
  steps: QaFormStep[];
}
export type QaFormAnswer =
  | { type: "text" | "textarea"; text: string }
  | {
      type: "single_select" | "multi_select";
      selected: string[];
      other_text?: string | undefined;
    };
export interface QaFormAttachment {
  attachment_id: string;
  version: number;
  name: string;
  size_bytes: number;
  media_type: string;
  sha256: string;
  resource_id: string;
}
export interface QaFormUpload {
  id: string;
  item_id: string;
  name: string;
  size_bytes: number;
  state: "pending" | "uploading" | "failed" | "ready" | "cancelled";
  expires_at: number;
  target?: { attachment_id: string; version: number } | undefined;
  result?: QaFormAttachment;
  error?: string;
}
export interface QaFormFieldError {
  step_id: string;
  item_id: string;
  component: "answer" | "files";
  code: string;
  message: string;
}
export interface QaFormSubmission {
  status: "submitted";
  form_id: string;
  submission_id: string;
  schema_version: 1;
  schema_hash: string;
  form_revision: number;
  submitted_at: string;
  items: {
    step_id: string;
    item_id: string;
    answer: QaFormAnswer | null;
    files: QaFormAttachment[];
  }[];
  empty_optional_item_ids: string[];
}
export interface QaFormRecord {
  storage_version: 1;
  id: string;
  session_id: string;
  creator_id: string;
  request_key: string;
  schema: QaFormSchema;
  schema_hash: string;
  status: "draft" | "submitted" | "cancelled" | "expired";
  revision: number;
  created_at: string;
  answers: Record<string, QaFormAnswer | null>;
  attachments: Record<string, QaFormAttachment[]>;
  uploads: QaFormUpload[];
  step: number;
  submission?: QaFormSubmission;
}
export type QaFormView = QaFormRecord & {
  waiting: boolean;
  field_errors: QaFormFieldError[];
};
export interface QaFormMutation {
  form_id: string;
  expected_revision: number;
  mutation_id: string;
}
export type QaFormCommand =
  | (QaFormMutation & {
      action: "save";
      answers: Record<string, QaFormAnswer | null>;
      step: number;
    })
  | (QaFormMutation & { action: "submit" | "pause" })
  | (QaFormMutation & {
      action: "begin_upload";
      item_id: string;
      name: string;
      size_bytes: number;
      target?: { attachment_id: string; version: number } | undefined;
    })
  | (QaFormMutation & { action: "cancel_upload"; upload_id: string })
  | (QaFormMutation & {
      action: "remove";
      item_id: string;
      attachment_id: string;
      version: number;
    });
export type QaFormResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        form_revision?: number;
        field_errors?: QaFormFieldError[];
      };
    };

/**
 * The store surface the service programs against.
 *
 * The service must never reach into a concrete storage backend: the shipped
 * store is sqlite (durable), and the client component tests mount an in-memory
 * implementation, which a browser test environment could never load through
 * the sqlite bridge.
 */
export interface QaFormStoreApi {
  list(session: string): QaFormRecord[];
  create(
    session: string,
    key: string,
    schema: QaFormRecord["schema"],
    creator?: string,
  ): QaFormRecord;
  get(session: string, id: string): QaFormRecord;
  editableOrSubmitted(record: QaFormRecord): void;
  mutate(
    session: string,
    id: string,
    revision: number,
    mutationId: string,
    input: unknown,
    work: (r: QaFormRecord) => void,
  ): QaFormRecord;
  update(
    session: string,
    id: string,
    work: (r: QaFormRecord) => void,
  ): QaFormRecord;
  resource(formId: string, id: string): Uint8Array;
  saveResource(formId: string, id: string, data: Uint8Array): void;
  storedBytes(session: string): number;
  identityReservedBytes(creator: string): number;
  cancelSession(session: string): void;
  /**
   * Submit retries are idempotent: when this mutation identity was already
   * applied, return its recorded result and refuse a reused identity that
   * carries different data. `null` means the identity is unused.
   */
  replayedMutation(
    formId: string,
    mutationId: string,
    input: unknown,
  ): QaFormRecord | null;
  close(): void;
}
