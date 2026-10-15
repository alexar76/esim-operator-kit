// The kit's guides as HTML for the /kit pages: the subset of Markdown they are written in — headings,
// paragraphs, lists, tables, fenced code, quotes, and inline code, bold and links. Every character
// of text is escaped; a link keeps its href only when `linkFor` returns one (http(s), mailto, an
// in-page anchor, or a route for another guide), so nothing in a document can run in the page.
// A block of raw HTML (the README's badges, hero and gallery, written for GitHub) is left out, and a
// ```mermaid block becomes <pre class="mermaid"> with its text escaped, for the page to draw.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

/** A heading's anchor: lower case, letters and digits of any script, dashes. */
export function slug(text) {
  return String(text).toLowerCase().replace(/[`*]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
}

/** The text of inline Markdown, without its marks (for titles, anchors and descriptions). */
export const plain = (s) => String(s).replace(INLINE, (_m, code, text, _h, bold) => code ?? plain(text ?? bold));

function inline(s, linkFor) {
  let out = "";
  let last = 0;
  for (const m of String(s).matchAll(INLINE)) {
    out += esc(s.slice(last, m.index));
    last = m.index + m[0].length;
    const [, code, text, href, bold] = m;
    if (code !== undefined) out += `<code>${esc(code)}</code>`;
    else if (bold !== undefined) out += `<strong>${inline(bold, linkFor)}</strong>`;
    else {
      const to = linkFor(href);
      out += to ? `<a href="${esc(to)}">${inline(text, linkFor)}</a>` : inline(text, linkFor);
    }
  }
  return out + esc(String(s).slice(last));
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isRule = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line || "");
const ITEM = /^(\s*)(-|\d+\.)\s+(.*)$/;

/**
 * Render `md`. Returns {title (the first h1, not rendered), html, toc: [{id, text}] of the h2s,
 * description (the first paragraph as plain text), mermaid (whether it has a diagram)}.
 */
export function renderMarkdown(md, { linkFor = (h) => (/^(https?:|mailto:|#)/.test(h) ? h : null) } = {}) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const toc = [];
  const ids = new Map();
  let title = "";
  let description = "";
  let mermaid = false;
  const anchor = (text) => {
    const base = slug(plain(text));
    const n = (ids.get(base) || 0) + 1;
    ids.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      if (fence[1] === "mermaid") { mermaid = true; out.push(`<pre class="mermaid">${esc(body.join("\n"))}</pre>`); continue; }
      out.push(`<pre${fence[1] ? ` data-lang="${esc(fence[1])}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    // Raw HTML, written for GitHub: the whole block, up to the next blank line, stays out of the page.
    if (/^\s*<[a-zA-Z!\/]/.test(line)) {
      while (i < lines.length && lines[i].trim()) i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      i++;
      if (h[1].length === 1 && !title) { title = plain(h[2]); continue; }
      const id = anchor(h[2]);
      if (h[1].length === 2) toc.push({ id, text: plain(h[2]) });
      out.push(`<h${h[1].length} id="${esc(id)}">${inline(h[2], linkFor)}</h${h[1].length}>`);
      continue;
    }
    if (line.trim().startsWith("|") && isRule(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]));
      const th = head.map((c) => `<th>${inline(c, linkFor)}</th>`).join("");
      const tb = rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "", linkFor)}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="table"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }
    if (ITEM.test(line)) {
      const ordered = /\d/.test(line.match(ITEM)[2]);
      const start = ordered ? Number(line.match(ITEM)[2].slice(0, -1)) : 1;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(ITEM);
        if (m && /\d/.test(m[2]) === ordered) { items.push(m[3]); i++; continue; }
        // A continuation line of the last item: indented, not blank, not a new block.
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !ITEM.test(lines[i])) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${items.map((t) => `<li>${inline(t, linkFor)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (line.startsWith(">")) {
      const quote = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(quote.join(" "), linkFor)}</p></blockquote>`);
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|>)/.test(lines[i]) && !ITEM.test(lines[i])
           && !(lines[i].trim().startsWith("|") && isRule(lines[i + 1])); i++) para.push(lines[i].trim());
    if (!para.length) para.push(lines[i++].trim());   // a line no block takes (e.g. "```js x") is text
    const text = para.join(" ");
    if (!description) description = plain(text);
    out.push(`<p>${inline(text, linkFor)}</p>`);
  }
  return { title, html: out.join("\n"), toc, description, mermaid };
}
