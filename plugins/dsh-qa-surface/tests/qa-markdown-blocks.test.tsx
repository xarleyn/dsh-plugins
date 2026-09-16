// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/client/components/Markdown.js";

/** The answer shape that prompted this renderer: MR review with C# diff. */
const MR_REVIEW = `Ревью MR !17025: #MDC-24859: поправка конструкторов сущностей MES

**MR:** [box/industry!17025](https://git.example.com/box/industry/-/merge_requests/17025)  
**Автор:** Andrey Mescheryakov (amescheryakov)  
**Ревьюер:** Oleg Osypants (o.osypants) — *одобрил*

---

## Суть изменений

MR решает проблему формирования карты типов композитного сервиса MES (MDC-24859).

#### 1. 🔵 Backend: EF-модели — \`protected\` → \`public\` конструкторы

**7 файлов:**

- \`ManufacturingAnalyticAssignment.cs\`
- \`ManufacturingOrderState.cs\`

**Что изменилось:**

\`\`\`csharp
// Было
protected ManufacturingOrderState() {
    FromStateHistories = new HashSet<ManufacturingOrderStateHistory>();
}

// Стало
public ManufacturingOrderState() {
    FromStateHistories = []; // C# 12 collection expressions
}
\`\`\`

#### 2. 🟢 Backend: TypeMap.cs — оптимизация инициализации ObjectType

До:

\`\`\`csharp
if (etAttr != null) {
    try {
        ObjectType = ((IxAuditable)Activator.CreateInstance(etAttr.EntityType)).GetEntityType();
    } catch {
        ObjectType = ObjectTypeEnum.Unknown;
    }
}
\`\`\`
`;

describe("assistant Markdown blocks", () => {
  it("renders every ATX heading level instead of leaking the hashes", () => {
    const { container } = render(
      <Markdown
        text={
          "# один\n\n## два\n\n### три\n\n#### четыре\n\n##### пять\n\n###### шесть"
        }
      />,
    );
    expect(
      [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
        (node) => node.tagName,
      ),
    ).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
    expect(container.textContent).not.toContain("#");
  });

  it("renders the MR review without leaking any markup", () => {
    const { container } = render(<Markdown text={MR_REVIEW} />);
    // The fourth-level heading is the one the old grammar rendered literally.
    const heading = container.querySelector("h4");
    expect(heading?.textContent).toBe(
      "1. 🔵 Backend: EF-модели — protected → public конструкторы",
    );
    expect(container.textContent).not.toContain("####");
    expect(container.textContent).not.toContain("**");
    expect(container.querySelectorAll("h2").length).toBe(1);
    expect(container.querySelector("hr")).toBeTruthy();
    // The metadata lines are hard breaks: one paragraph, three visual lines.
    const paragraph = [...container.querySelectorAll("p")].find((node) =>
      node.textContent?.includes("Автор"),
    );
    expect(paragraph?.querySelectorAll("br").length).toBe(2);
    expect(paragraph?.querySelector("a")?.textContent).toContain(
      "box/industry!17025",
    );
    expect(paragraph?.querySelector("em")?.textContent).toBe("одобрил");
    const fences = container.querySelectorAll(".dsh-qa-md-code");
    expect(fences.length).toBe(2);
    expect(fences[0]?.querySelector(".dsh-qa-md-code__lang")?.textContent).toBe(
      "csharp",
    );
    expect(
      fences[0]?.querySelectorAll(".dsh-qa-md-tok").length,
    ).toBeGreaterThan(4);
  });

  it("sets a fenced block's language, copy button, and highlight tokens", () => {
    const { container } = render(
      <Markdown text={'```json\n{"a": 1, "b": "x"}\n```'} />,
    );
    const block = container.querySelector(".dsh-qa-md-code");
    expect(block?.querySelector("code")?.getAttribute("data-language")).toBe(
      "json",
    );
    const tokens = [...(block?.querySelectorAll(".dsh-qa-md-tok") ?? [])];
    expect(tokens.map((token) => token.getAttribute("data-tok"))).toEqual([
      "key",
      "number",
      "key",
      "string",
    ]);
    const copy = block?.querySelector("button");
    expect(copy?.textContent).toBe("Копировать");
  });

  it("copies the fence source, and says so once it did", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(
      <Markdown text={"```sh\nnpm run build\n```"} />,
    );
    const copy = container.querySelector("button");
    expect(copy).not.toBeNull();
    await act(async () => {
      if (copy !== null) fireEvent.click(copy);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("npm run build");
    expect(copy?.textContent).toBe("Скопировано");
  });

  it("keeps nested lists, tight items, and task checkboxes", () => {
    const { container } = render(
      <Markdown
        text={
          "- верхний\n  - вложенный\n- [x] сделано\n- [ ] осталось\n\n1. один\n   1. вложенный\n2. два"
        }
      />,
    );
    const [first] = [...container.querySelectorAll("ul")];
    expect(first?.querySelector(":scope > li > ul > li")?.textContent).toBe(
      "вложенный",
    );
    // A tight item keeps its text outside a paragraph, as GFM renders it.
    expect(
      first?.querySelector(":scope > li")?.querySelector(":scope > p"),
    ).toBeNull();
    const boxes = [
      ...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    ];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    const ordered = container.querySelector("ol");
    expect(ordered?.querySelector(":scope > li > ol > li")?.textContent).toBe(
      "вложенный",
    );
    expect(
      [...(ordered?.querySelectorAll(":scope > li") ?? [])].map((item) =>
        item.firstChild?.textContent?.trim(),
      ),
    ).toEqual(["один", "два"]);
  });

  it("reads soft breaks as spaces and hard breaks as breaks", () => {
    const { container } = render(
      <Markdown text={"строка один\nстрока два\n\nхвост  \nконец"} />,
    );
    const [soft, hard] = [...container.querySelectorAll("p")];
    expect(soft?.querySelector("br")).toBeNull();
    expect(soft?.textContent).toBe("строка один\nстрока два");
    expect(hard?.querySelector("br")).toBeTruthy();
  });

  it("links bare URLs and inline-code URLs, and leaves other schemes alone", () => {
    const { container } = render(
      <Markdown
        text={
          "Смотри https://example.com/a?b=1, и `https://example.com/x`, и `javascript:alert(1)`."
        }
      />,
    );
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/a?b=1",
      "https://example.com/x",
    ]);
    // The code chrome survives the promotion, and the URL glyph leads the text.
    expect(links[1]?.closest("code")).not.toBeNull();
    expect(links[0]?.querySelector(".dsh-qa-md-link-icon")).not.toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });

  it("resolves reference links and drops their definitions", () => {
    const { container } = render(
      <Markdown text={"[док][spec]\n\n[spec]: https://example.com/spec"} />,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/spec",
    );
    expect(container.textContent).not.toContain("[spec]");
  });

  it("honors backslash escapes and strikethrough", () => {
    const { container } = render(
      <Markdown text={"\\*не курсив\\* и ~~удалено~~"} />,
    );
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toBe("*не курсив* и удалено");
    expect(container.querySelector("del")?.textContent).toBe("удалено");
  });

  it("renders remote images and degrades a local destination to its alt text", () => {
    const { container } = render(
      <Markdown
        text={
          "![схема](https://example.com/a.png)\n\n![локальная](C:/tmp/a.png)"
        }
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
    expect(container.querySelectorAll("img").length).toBe(1);
    expect(container.querySelector(".dsh-qa-md-image-alt")?.textContent).toBe(
      "локальная",
    );
  });

  it("keeps quotes multiline and headings setext", () => {
    const { container } = render(
      <Markdown text={"> первый\n> второй\n\nЗаголовок\n==="} />,
    );
    const quote = container.querySelector("blockquote");
    expect(quote?.querySelectorAll("p").length).toBe(1);
    expect(quote?.textContent?.trim()).toBe("первый\nвторой");
    expect(container.querySelector("h1")?.textContent).toBe("Заголовок");
  });

  it("renders an ordered list that starts where the source says", () => {
    const { container } = render(<Markdown text={"3. три\n4. четыре"} />);
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
  });
});
