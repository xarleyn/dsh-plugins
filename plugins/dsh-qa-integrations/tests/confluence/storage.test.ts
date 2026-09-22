import {
  isStorage,
  storageToText,
} from "../../src/providers/confluence/storage.js";

describe("confluence storage format", () => {
  it("renders paragraphs, headings, inline marks, links and breaks", () => {
    expect(storageToText("<p>Hello <strong>world</strong></p>")).toBe(
      "Hello **world**",
    );
    expect(
      storageToText(
        "<h1>One</h1><h2>Two</h2><h3>Three</h3>" +
          "<h4>Four</h4><h5>Five</h5><h6>Six</h6>",
      ),
    ).toBe(
      "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six",
    );
    expect(
      storageToText(
        "<p><b>bold</b> <i>italic</i> <code>npm ci</code> " +
          "<s>old</s> <del>gone</del></p>",
      ),
    ).toBe("**bold** _italic_ `npm ci` ~~old~~ ~~gone~~");
    expect(
      storageToText(
        '<p>see <a href="https://example.com/rb">the runbook</a></p>',
      ),
    ).toBe("see [the runbook](https://example.com/rb)");
    expect(storageToText("<p>first<br/>second</p>")).toBe("first\nsecond");
    // The indentation a pretty-printed body carries is not the reader's text.
    expect(storageToText("<p>\n  wrapped\n  words\n</p>\n<p>next</p>\n")).toBe(
      "wrapped words\n\nnext",
    );
  });

  it("nests bullet and ordered lists two spaces per level", () => {
    expect(
      storageToText(
        "<ul><li>first<ul><li>nested</li></ul></li><li>second</li></ul>",
      ),
    ).toBe("- first\n  - nested\n- second");
    expect(storageToText("<ol><li>one</li><li>two</li></ol>")).toBe(
      "1. one\n2. two",
    );
    expect(storageToText("<ul><li>step<ol><li>one</li></ol></li></ul>")).toBe(
      "- step\n  1. one",
    );
    expect(storageToText("<ul><li>first<li>second</ul>")).toBe(
      "- first\n- second",
    );
  });

  it("renders tables with a header separator and uneven rows", () => {
    const text = storageToText(
      "<table>" +
        "<thead><tr><th>env</th><th>url</th></tr></thead>" +
        "<tbody>" +
        "<tr><td>prod</td><td>https://a|b</td></tr>" +
        "<tr><td>dev</td></tr>" +
        "</tbody></table>",
    );
    expect(text).toBe(
      "| env | url |\n| --- | --- |\n| prod | https://a\\|b |\n| dev |",
    );
  });

  it("renders quotes, fenced code and rules", () => {
    expect(
      storageToText("<blockquote><p>quoted</p><p>more</p></blockquote>"),
    ).toBe("> quoted\n> \n> more");
    expect(storageToText("<pre>make deploy</pre>")).toBe(
      "```\nmake deploy\n```",
    );
    expect(storageToText("<p>a</p><hr/><p>b</p>")).toBe("a\n\n---\n\nb");
  });

  it("names a macro and renders its body, never its parameters", () => {
    expect(
      storageToText(
        '<ac:structured-macro ac:name="info">' +
          "<ac:rich-text-body><p>Careful</p></ac:rich-text-body>" +
          "</ac:structured-macro>",
      ),
    ).toBe("[macro: info]\nCareful");
    // A macro with no body is a placeholder and nothing else.
    expect(storageToText('<ac:structured-macro ac:name="toc"/>')).toBe(
      "[macro: toc]",
    );
    // The language parameter names the fence of a code macro's own body.
    const code = storageToText(
      '<ac:structured-macro ac:name="code">' +
        '<ac:parameter ac:name="language">bash</ac:parameter>' +
        "<ac:plain-text-body><![CDATA[make deploy\nexport ENV=prod]]>" +
        "</ac:plain-text-body></ac:structured-macro>",
    );
    expect(code).toBe(
      "[macro: code]\n```bash\nmake deploy\nexport ENV=prod\n```",
    );
    expect(code.match(/bash/gu)).toHaveLength(1);
    // The same macro around a `pre` names that fence too.
    expect(
      storageToText(
        '<ac:structured-macro ac:name="code">' +
          '<ac:parameter ac:name="language">js</ac:parameter>' +
          "<pre>npm ci</pre></ac:structured-macro>",
      ),
    ).toBe("[macro: code]\n```js\nnpm ci\n```");
    // Any other parameter is configuration, not a word of the page.
    const titled = storageToText(
      '<ac:structured-macro ac:name="info">' +
        '<ac:parameter ac:name="title">Internal runbook</ac:parameter>' +
        "</ac:structured-macro>",
    );
    expect(titled).toBe("[macro: info]");
    expect(titled).not.toContain("Internal runbook");
  });

  it("marks references instead of following them", () => {
    expect(
      storageToText(
        '<p>see <ri:attachment ri:filename="runbook.pdf"/> and ' +
          '<ri:page ri:content-title="Deployment Guide"/> for ' +
          '<ri:user ri:username="alice"/> in ' +
          '<ri:space ri:space-key="ENG"/></p>',
      ),
    ).toBe(
      "see [attachment: runbook.pdf] and [page: Deployment Guide] " +
        "for @alice in [space: ENG]",
    );
    expect(
      storageToText(
        '<p><ac:image ac:alt="chart"/> ' +
          '<ac:image><ri:attachment ri:filename="diagram.png"/></ac:image> ' +
          "<ac:image/></p>",
      ),
    ).toBe("[image: chart] [image: diagram.png] [image]");
    // A link shows its own words; a bare reference falls back to its marker.
    expect(
      storageToText(
        '<p><ac:link><ri:page ri:content-title="Deployment Guide"/>' +
          "<ac:plain-text-link-body><![CDATA[the guide]]>" +
          "</ac:plain-text-link-body></ac:link></p>",
      ),
    ).toBe("the guide");
    expect(
      storageToText(
        '<p><ac:link><ri:page ri:content-title="Deployment Guide"/>' +
          "</ac:link></p>",
      ),
    ).toBe("[page: Deployment Guide]");
  });

  it("decodes the entities a storage body emits", () => {
    expect(
      storageToText(
        "<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; f&nbsp;g " +
          "&mdash; &#8212; &hellip; &#x27; &#x2014;</p>",
      ),
    ).toBe("a & b <c> \"d\" 'e' f g \u2014 \u2014 \u2026 ' \u2014");
    // An entity that decodes to an entity is not decoded a second time.
    expect(storageToText("<p>&amp;lt; stays escaped once</p>")).toBe(
      "&lt; stays escaped once",
    );
    // A body that escaped its code is decoded once, like any other text.
    expect(storageToText("<pre>&amp;amp;</pre>")).toBe("```\n&amp;\n```");
    // CDATA is not escaped, so it is not decoded either.
    expect(storageToText("<pre><![CDATA[&amp;amp;]]></pre>")).toBe(
      "```\n&amp;amp;\n```",
    );
  });

  it("keeps an unknown tag's words and drops a self-closing one", () => {
    expect(
      storageToText("<p>a <foobar>kept</foobar> b <widget-1/> c</p>"),
    ).toBe("a kept b c");
    // An unknown block keeps the words of the blocks it wrapped.
    expect(storageToText("<div><p>wrapped</p></div>")).toBe("wrapped");
    // A tag we do not render is not a word: nothing is invented for it.
    expect(storageToText("<p><custom-widget/></p>")).toBe("");
  });

  it("answers nothing for input that is not a storage body", () => {
    for (const value of [undefined, null, 42, {}, [], "", "   ", "<p></p>"]) {
      expect(storageToText(value)).toBe("");
    }
    expect(isStorage("<p>hi</p>")).toBe(true);
    expect(isStorage('  <ac:structured-macro ac:name="toc"/>')).toBe(true);
    expect(isStorage('{"type":"doc","content":[]}')).toBe(false);
    expect(isStorage("plain text")).toBe(false);
    expect(isStorage("")).toBe(false);
    expect(isStorage(undefined)).toBe(false);
  });

  it("survives a body nested far deeper than it renders", () => {
    let body = "buried";
    for (let index = 0; index < 200; index += 1) {
      body = `<div>${body}</div>`;
    }
    expect(storageToText(body)).toBe("");
    // Unbalanced markup is not a trap either: the words still come out.
    expect(storageToText("<div><p>text")).toBe("text");
    expect(storageToText("</p></div>text")).toBe("text");
    expect(storageToText("<p>a<unclosed")).toBe("a<unclosed");
  });

  it("drops control characters but keeps tab and line endings", () => {
    expect(storageToText("<p>a\u0000\u0007b</p>")).toBe("ab");
    expect(storageToText("<pre>a\tb\nc\rd</pre>")).toBe("```\na\tb\nc\rd\n```");
  });

  it("returns a body that has no markup at all as that text", () => {
    expect(storageToText("Just a sentence.")).toBe("Just a sentence.");
    expect(storageToText("  spaced  ")).toBe("spaced");
  });
});
