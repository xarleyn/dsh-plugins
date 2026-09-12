import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { QaImageDraft, QaSource, QaTurnSources } from "../types.js";
import { revokeObjectUrlIfBlob } from "./session-assets.js";

/** Snapshot completeness captured when a drawer was opened from a message. */
export interface QaDrawerCompleteness {
  readonly complete: boolean;
  readonly incompleteOrigins?: QaTurnSources["incompleteOrigins"];
}

export interface QaSessionUiState {
  /** Per group: how many answers back from the newest is shown (0 = newest). */
  readonly variantOffsets: Record<string, number>;
  readonly setVariantOffsets: Dispatch<SetStateAction<Record<string, number>>>;
  /** The turn the transcript's reading line currently owns. */
  readonly activeTurn: number | null;
  readonly setActiveTurn: Dispatch<SetStateAction<number | null>>;
  readonly agentsOpen: boolean;
  readonly setAgentsOpen: Dispatch<SetStateAction<boolean>>;
  readonly sourcesOpen: boolean;
  readonly setSourcesOpen: Dispatch<SetStateAction<boolean>>;
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
  readonly pendingImages: readonly QaImageDraft[];
  readonly setPendingImages: (next: readonly QaImageDraft[]) => void;
}

/**
 * Per-chat UI state: composer attachments, variant offsets, the rail mark and
 * the drawers. Everything here describes the chat it was made in, so a
 * session change clears it instead of leaking a draft, an image or a drawer
 * from one conversation into the next.
 */
export function useSessionUiState(sessionId: string | null): QaSessionUiState {
  /** Per group: how many answers back from the newest is shown (0 = newest). */
  const [variantOffsets, setVariantOffsets] = useState<Record<string, number>>(
    {},
  );
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [drawerSources, setDrawerSources] = useState<
    readonly QaSource[] | null
  >(null);
  const [drawerCompleteness, setDrawerCompleteness] =
    useState<QaDrawerCompleteness | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<QaSource | null>(null);
  const [pendingImages, setPendingImagesState] = useState<
    readonly QaImageDraft[]
  >([]);
  /** Mirror of the live drafts: blob URLs to revoke when they leave state. */
  const pendingImagesRef = useRef<readonly QaImageDraft[]>([]);

  /**
   * The single entry point that changes the draft set: every image that
   * leaves state has its preview blob URL revoked here, whether it was
   * removed by the composer, cleared by a send or dropped on a chat switch.
   */
  const setPendingImages = useCallback((next: readonly QaImageDraft[]) => {
    for (const draft of pendingImagesRef.current) {
      if (!next.includes(draft)) revokeObjectUrlIfBlob(draft.previewUrl);
    }
    pendingImagesRef.current = next;
    setPendingImagesState(next);
  }, []);

  useEffect(() => {
    setVariantOffsets({});
    setActiveTurn(null);
    setAgentsOpen(false);
    setSourcesOpen(false);
    setDrawerSources(null);
    setDrawerCompleteness(null);
    setDrawerDetail(null);
    setPendingImages([]);
  }, [sessionId, setPendingImages]);

  // Whatever is still attached dies with the surface, and its URLs with it.
  useEffect(
    () => () => {
      for (const draft of pendingImagesRef.current)
        revokeObjectUrlIfBlob(draft.previewUrl);
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
    sourcesOpen,
    setSourcesOpen,
    drawerSources,
    setDrawerSources,
    drawerCompleteness,
    setDrawerCompleteness,
    drawerDetail,
    setDrawerDetail,
    pendingImages,
    setPendingImages,
  };
}
