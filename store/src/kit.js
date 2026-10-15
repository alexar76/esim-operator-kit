// The kit's own documentation, served by the demo storefront at /kit, /kit/rails, /kit/integrations,
// /kit/sdk, /kit/operator and /kit/agents in each of the five languages: README.md (README.<lang>.md) and docs/<lang>/*.md from
// the kit's root, rendered once at start. A link between the guides becomes the matching /kit route;
// a link to another file of the kit points at it in the public repository.
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { LANGS } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";
import { pathFor } from "./pages.js";

export const KIT_REPO = "https://github.com/alexar76/esim-operator-kit";
/** /kit/<page> → the guide's file name. */
export const KIT_PAGES = { "": "README", rails: "rails", integrations: "integrations", sdk: "sdk", operator: "operator-guide", agents: "agent-guide", cases: "cases", hub: "own-hub" };
const PAGE_OF = Object.fromEntries(Object.entries(KIT_PAGES).map(([p, f]) => [f, p]));

export const kitFile = (lang, name) => (name === "README" ? (lang === "en" ? "README.md" : `README.${lang}.md`) : `docs/${lang}/${name}.md`);
export const kitPath = (lang, page) => pathFor(lang, page ? `kit/${page}` : "kit");

/** Where a link written in `file` goes on the site. */
export function kitLink(file, href) {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("#")) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const [path, hash] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(file), path));
  if (target.startsWith("../")) return null;
  const suffix = hash ? `#${hash}` : "";
  if (target === "README.md") return kitPath("en", "") + suffix;
  const readme = target.match(/^README\.([a-z]{2})\.md$/);
  if (readme && LANGS.includes(readme[1])) return kitPath(readme[1], "") + suffix;
  const doc = target.match(/^docs\/([a-z]{2})\/([\w-]+)\.md$/);
  if (doc && LANGS.includes(doc[1]) && doc[2] in PAGE_OF) return kitPath(doc[1], PAGE_OF[doc[2]]) + suffix;
  return `${KIT_REPO}/${target.endsWith("/") ? "tree" : "blob"}/main/${target}${suffix}`;
}

/**
 * Read and render every guide: Map "<lang>|<page>" → {title, description, html, toc}. Null when the
 * kit's README is not there (a store built without the docs serves no /kit pages).
 */
export function loadKit({ root = new URL("../../", import.meta.url), read = (f) => readFileSync(new URL(f, root), "utf8") } = {}) {
  const docs = new Map();
  for (const lang of LANGS) {
    for (const [page, name] of Object.entries(KIT_PAGES)) {
      const file = kitFile(lang, name);
      let md;
      try { md = read(file); } catch { continue; }
      docs.set(`${lang}|${page}`, renderMarkdown(md, { linkFor: (href) => kitLink(file, href) }));
    }
  }
  return docs.has("en|") ? docs : null;
}
