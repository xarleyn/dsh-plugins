import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QaCodeSourcePicker } from "../../src/client/components/QaCodeSourcePicker.js";
import { codeSourceStyles } from "../../src/client/code-source-styles.js";
import type { QaChatCodeSources } from "../../src/types/code-sources.js";

const initial: QaChatCodeSources = {
  selectedSource: "preview",
  effectiveSource: "preview",
  entries: [
    { id: "stable", label: "2.0 — релиз" },
    { id: "preview", label: "2.0 — разработка" },
  ],
  writable: true,
  unavailable: false,
};
function Preview() {
  const [value, setValue] = useState(initial);
  const choose = async (source: string | null) => {
    setValue({
      ...value,
      selectedSource: source,
      effectiveSource: source ?? "stable",
    });
  };
  return (
    <main>
      <style>{`:root{--dsw-alias-label-primary:#e8e8e8;--dsw-alias-label-secondary:#ccc;--dsw-alias-label-tertiary:#aaa;--dsw-alias-bg-layer-2:#272727;--dsw-alias-border-l2:#555;--dsw-alias-state-error-primary:#ff9999;--dsw-alias-state-business-primary:#81b7ff}body{margin:0;background:#181818;color:var(--dsw-alias-label-primary);font:14px/1.5 system-ui}main{max-width:680px;margin:32px auto;padding:16px;box-sizing:border-box}section{padding:16px;margin:16px 0;background:#272727;border-radius:12px}textarea{box-sizing:border-box;width:100%;min-height:80px;padding:12px;background:#1f1f1f;color:inherit;border:1px solid #555;border-radius:8px;font:inherit}h1{font-size:20px}h2{font-size:14px;font-weight:500}${codeSourceStyles}`}</style>
      <h1>Версия кода в чате</h1>
      <section>
        <h2>Выбор сохранён</h2>
        <QaCodeSourcePicker
          value={value}
          pending={false}
          error={null}
          disabled={false}
          onSelect={choose}
        />
        <textarea aria-label="Сообщение" placeholder="Задайте вопрос…" />
      </section>
      <section>
        <h2>Ответ выполняется</h2>
        <QaCodeSourcePicker
          value={value}
          pending={false}
          error={null}
          disabled={true}
          onSelect={choose}
        />
      </section>
      <section>
        <h2>Ошибка сохранения</h2>
        <QaCodeSourcePicker
          value={value}
          pending={false}
          error="Не удалось сохранить версию. Выбор не изменён."
          disabled={false}
          onSelect={choose}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
