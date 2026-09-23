import mermaid from "mermaid";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { CodeBlock } from "./CodeBlock.js";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "neutral",
  flowchart: { htmlLabels: false },
});

/** Remove executable and remotely loading SVG features before DOM insertion. */
export function sanitizeMermaidSvg(svg: string): Element {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.nodeName.toLowerCase() !== "svg") {
    throw new Error("Mermaid returned invalid SVG");
  }
  for (const element of document.querySelectorAll(
    "script,foreignObject,iframe,object,embed,audio,video,image",
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (
        (name === "href" || name === "xlink:href") &&
        !value.startsWith("#")
      ) {
        element.removeAttribute(attribute.name);
      }
      if (name === "style" && /url\(\s*["']?(?!#)/iu.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return root;
}

function MermaidCanvas({
  diagram,
  zoom,
}: {
  readonly diagram: Element;
  readonly zoom: number;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    canvas.current?.replaceChildren(diagram.cloneNode(true));
  }, [diagram]);
  return (
    <div
      ref={canvas}
      className="dsh-qa-mermaid__canvas"
      style={{ width: `${zoom * 100}%` }}
    />
  );
}

export const MermaidBlock = memo(function MermaidBlock({
  code,
}: {
  readonly code: string;
}) {
  const reactId = useId();
  const renderId = useMemo(
    () => `dsh-qa-mermaid-${reactId.replace(/[^a-z0-9_-]/giu, "")}`,
    [reactId],
  );
  const [diagram, setDiagram] = useState<Element>();
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let active = true;
    setDiagram(undefined);
    setFailed(false);
    void mermaid.render(renderId, code).then(
      ({ svg: rendered }) => {
        if (!active) return;
        try {
          setDiagram(sanitizeMermaidSvg(rendered));
        } catch {
          setFailed(true);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [code, renderId]);

  if (failed) {
    return (
      <div className="dsh-qa-mermaid dsh-qa-mermaid--error">
        <p role="status">
          Не удалось отобразить Mermaid-диаграмму. Показан исходный код.
        </p>
        <CodeBlock code={code} lang="mermaid" />
      </div>
    );
  }

  return (
    <section
      className={`dsh-qa-mermaid${expanded ? " dsh-qa-mermaid--expanded" : ""}`}
      aria-label="Диаграмма Mermaid"
    >
      <header className="dsh-qa-mermaid__toolbar">
        <strong>Mermaid</strong>
        <span className="dsh-qa-mermaid__actions">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            aria-label="Уменьшить диаграмму"
          >
            −
          </button>
          <button type="button" onClick={() => setZoom(1)}>
            По размеру
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}
            aria-label="Увеличить диаграмму"
          >
            +
          </button>
          <button
            type="button"
            aria-pressed={showCode}
            onClick={() => setShowCode((value) => !value)}
          >
            {showCode ? "Скрыть код" : "Код"}
          </button>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Закрыть" : "Во весь экран"}
          </button>
        </span>
      </header>
      <div className="dsh-qa-mermaid__viewport">
        {diagram === undefined ? (
          <span className="dsh-qa-mermaid__loading" role="status">
            Строим диаграмму…
          </span>
        ) : (
          <MermaidCanvas diagram={diagram} zoom={zoom} />
        )}
      </div>
      {showCode ? <CodeBlock code={code} lang="mermaid" /> : null}
    </section>
  );
});
