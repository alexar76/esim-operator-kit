import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LANGS } from "../src/i18n.js";
import { KIT_PAGES, kitFile, kitLink, loadKit } from "../src/kit.js";
import { renderMarkdown, slug } from "../src/markdown.js";

const ROOT = new URL("../../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");

test("markdown: escapes every text, keeps only the links it is given", () => {
  const md = [
    "# Title <b>",
    "",
    "Intro with `<script>` and **bold [link](https://a.example/?q=1&x=\"y\")** and [bad](javascript:void0).",
    "",
    "## Steps & more",
    "",
    "1. one",
    "   continued",
    "",
    "```bash",
    "echo '<x>' && true",
    "```",
    "",
    "2. two",
    "",
    "| A | B |",
    "|---|---|",
    "| `x` | <img> |",
    "",
    "> quote <i>",
    "",
    "## Steps & more",
    "",
    "- item",
    "<script>alert(1)</script>",
  ].join("\n");
  const r = renderMarkdown(md);
  assert.equal(r.title, "Title <b>");
  assert.equal(r.description, "Intro with <script> and bold link and bad.");
  assert.ok(!/<script|<img|<b>|<i>/.test(r.html), r.html);
  assert.ok(r.html.includes('<a href="https://a.example/?q=1&amp;x=&quot;y&quot;">link</a>'));
  assert.ok(r.html.includes("and bad."), "a javascript: link keeps its text, loses its href");
  assert.ok(r.html.includes('<ol><li>one continued</li></ol>'));
  assert.ok(r.html.includes('<ol start="2"><li>two</li></ol>'), "a list split by a code block keeps counting");
  assert.ok(r.html.includes('<pre data-lang="bash"><code>echo &#39;&lt;x&gt;&#39; &amp;&amp; true</code></pre>'));
  assert.ok(r.html.includes("<th>A</th><th>B</th>") && r.html.includes("<td>&lt;img&gt;</td>"));
  assert.ok(r.html.includes("<blockquote><p>quote &lt;i&gt;</p></blockquote>"));
  assert.deepEqual(r.toc.map((h) => h.id), ["steps-more", "steps-more-2"], "repeated headings get distinct anchors");
  assert.equal(slug("6. Положите ключи"), "6-положите-ключи");
  assert.equal(slug("9. 智能体与联邦"), "9-智能体与联邦");
  assert.equal(renderMarkdown("```js x\nok").html.includes("```js x"), true, "a line no block takes ends as text");
});

test("kit links: between guides to /kit routes, other files to the repo, nothing outside the kit", () => {
  assert.equal(kitLink("README.md", "docs/en/operator-guide.md"), "/kit/operator");
  assert.equal(kitLink("README.md", "docs/ru/README.md"), "/ru/kit");
  assert.equal(kitLink("docs/fr/agent-guide.md", "operator-guide.md#9-agents-et-fédération"), "/fr/kit/operator#9-agents-et-fédération");
  assert.equal(kitLink("docs/es/README.md", "../../README.md"), "/kit");
  assert.equal(kitLink("docs/zh/operator-guide.md", "../../secrets/README.md"), "https://github.com/alexar76/esim-operator-kit/blob/main/secrets/README.md");
  assert.equal(kitLink("docs/en/agent-guide.md", "#4-buy"), "#4-buy");
  assert.equal(kitLink("docs/en/agent-guide.md", "../../../etc/passwd"), null);
  assert.equal(kitLink("README.md", "javascript:alert(1)"), null);
  assert.equal(kitLink("README.md", "//evil.example/x"), null);
});

test("the guides: every one loads in five languages, every relative link resolves, translations keep the English structure", () => {
  const kit = loadKit();
  assert.ok(kit);
  const shape = (md) => ({
    h2: (md.match(/^## /gm) || []).length,
    code: (md.match(/^```/gm) || []).length,
    tables: (md.match(/^\|[-| :]+\|$/gm) || []).length,
  });
  for (const name of Object.values(KIT_PAGES)) {
    const en = shape(read(kitFile("en", name)));
    for (const lang of LANGS) {
      const file = kitFile(lang, name);
      const md = read(file);
      assert.deepEqual(shape(md), en, `${file} has the sections, code blocks and tables of the English one`);
      for (const [, href] of md.matchAll(/\]\(([^)\s]+)\)/g)) {
        assert.ok(kitLink(file, href), `${file}: ${href} resolves`);
        const to = kitLink(file, href);
        if (!/^https?:/.test(href) && to.startsWith("https://github.com/alexar76/esim-operator-kit/")) {
          const path = to.replace(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(blob|tree)\/main\//, "").split("#")[0];
          assert.ok(existsSync(new URL(path, ROOT)), `${file}: ${href} points at a file or folder of the kit`);
        }
      }
      const doc = kit.get(`${lang}|${Object.keys(KIT_PAGES).find((k) => KIT_PAGES[k] === name)}`);
      assert.ok(doc.title && doc.description && doc.html.length > 1000, file);
    }
  }
});
