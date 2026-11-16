import { useRef, type ReactNode } from "react";
import { QaWidthHandle, useQaContentWidth } from "./QaWidthHandle.js";

/** The column can mount after authentication, even on an already active route. */
export function QaChatColumn(props: {
  readonly children: ReactNode;
  readonly resizable: boolean;
  readonly storageKey: string;
  readonly minContentWidth: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const handles = useQaContentWidth({
    root,
    storage: window.localStorage,
    storageKey: props.storageKey,
    minContentWidth: props.minContentWidth,
  });
  return (
    <div ref={root} className="dsh-qa-chat" data-testid="qa-surface-chat">
      {props.children}
      {props.resizable &&
        (["left", "right"] as const).map((side) => (
          <QaWidthHandle key={side} side={side} {...handles} />
        ))}
    </div>
  );
}
