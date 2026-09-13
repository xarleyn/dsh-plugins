import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { QaAttachmentDraft, QaSource, QaTurnSources } from "../types.js";
import { revokeObjectUrlIfBlob } from "./session-assets.js";

/** Snapshot completeness captured when a drawer was opened from a message. */
export interface QaDrawerCompleteness {
  readonly complete: boolean;
  readonly incompleteOrigins?: QaTurnSources["incompleteOrigins"];
}

/** The rail tab ids; the agents drawer has not become a tab yet. */
export type QaRailTab = "sources" | "files";

export interface QaSessionUiState {
  /** Per group: how many answers back from the newest is shown (0 = newest). */
  readonly variantOffsets: Record<string, number>;
  readonly setVariantOffsets: Dispatch<SetStateAction<Record<string, number>>>;
  /** The turn the transcript's reading line currently owns. */
  readonly activeTurn: number | null;
  readonly setActiveTurn: Dispatch<SetStateAction<number | null>>;
  readonly agentsOpen: boolean;
  readonly setAgentsOpen: Dispatch<SetStateAction<boolean>>;
  /** Whether the right rail column is shown. */
  readonly railOpen: boolean;
  readonly setRailOpen: Dispatch<SetStateAction<boolean>>;
  /** Which rail tab is active; meaningful only while the rail is open. */
  readonly railTab: QaRailTab;
  readonly setRailTab: Dispatch<SetStateAction<QaRailTab>>;
  readonly drawerSources: readonly QaSource[] | null;
  readonly setDrawerSources: Dispatch<
    SetStateAction<readonly QaSource[] | null>
  >;
  readonly drawerCompleteness: QaDrawerCompleteness | null;
  readonly setDrawerCompleteness: Dispatch<
    SetStateAction<QaDrawerCompleteness | null>
  >;
  readonly drawerDetail: QaSource | null;
  readonly setDrawerDetail: Dispatch<SetStateAction<QaSource | null>>;
  readonly pendingAttachments: readonly QaAttachmentDraft[];
  readonly setPendingAttachments: (next: readonly QaAttachmentDraft[]) => void;
}

/**
 * Per-chat UI state: composer attachments, variant offsets, the rail mark and
 * the drawers. Everything here describes the chat it was made in, so a
 * session change clears it instead of leaking a draft, an attachment or a
 * drawer from one conversation into the next.
 */
export function useSessionUiState(sessionId: string | null): QaSessionUiState {
  /** Per group: how many answers back from the newest is shown (0 = newest). */
  const [variantOffsets, setVariantOffsets] = useState<Record<string, number>>(
    {},
  );
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [railTab, setRailTab] = useState<QaRailTab>("sources");
  const [drawerSources, setDrawerSources] = useState<
    readonly QaSource[] | null
  >(null);
  const [drawerCompleteness, setDrawerCompleteness] =
    useState<QaDrawerCompleteness | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<QaSource | null>(null);
  const [pendingAttachments, setPendingAttachmentsState] = useState<
    readonly QaAttachmentDraft[]
  >([]);
  /** Mirror of the live drafts: blob URLs to revoke when they leave state. */
  const pendingAttachmentsRef = useRef<readonly QaAttachmentDraft[]>([]);

  /**
   * The single entry point that changes the draft set: every image that
   * leaves state has its preview blob URL revoked here, whether it was
   * removed by the composer, cleared by a send or dropped on a chat switch.
   */
  const setPendingAttachments = useCallback(
    (next: readonly QaAttachmentDraft[]) => {
      for (const draft of pendingAttachmentsRef.current) {
        if (draft.kind === "image" && !next.includes(draft)) {
          revokeObjectUrlIfBlob(draft.previewUrl);
        }
      }
      pendingAttachmentsRef.current = next;
      setPendingAttachmentsState(next);
    },
    [],
  );

  useEffect(() => {
    setVariantOffsets({});
    setActiveTurn(null);
    setAgentsOpen(false);
    setRailOpen(false);
    setRailTab("sources");
    setDrawerSources(null);
    setDrawerCompleteness(null);
    setDrawerDetail(null);
    setPendingAttachments([]);
  }, [sessionId, setPendingAttachments]);

  // Whatever is still attached dies with the surface, and its URLs with it.
  useEffect(
    () => () => {
      for (const draft of pendingAttachmentsRef.current) {
        if (draft.kind === "image") revokeObjectUrlIfBlob(draft.previewUrl);
      }
    },
    [],
  );

  return {
    variantOffsets,
    setVariantOffsets,
    activeTurn,
    setActiveTurn,
    agentsOpen,
    setAgentsOpen,
    railOpen,
    setRailOpen,
    railTab,
    setRailTab,
    drawerSources,
    setDrawerSources,
    drawerCompleteness,
    setDrawerCompleteness,
    drawerDetail,
    setDrawerDetail,
    pendingAttachments,
    setPendingAttachments,
  };
}
