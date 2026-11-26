import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const destination = resolve(process.argv[2] ?? ".");
const { version, license, engines, repository, bugs } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stage = mkdtempSync(join(tmpdir(), "esim-rails-check-"));
try {
  for (const path of ["bin/esim-rails-check.mjs", "src/canonical.js", "src/check.js", "src/schema.js"]) {
    const target = join(stage, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  cpSync(join(root, "spec/esim-v1"), join(stage, "spec/esim-v1"), { recursive: true });
  copyFileSync(join(root, "spec/conformance.md"), join(stage, "README.md"));
  copyFileSync(join(root, "../LICENSE"), join(stage, "LICENSE"));
  writeFileSync(join(stage, "package.json"), JSON.stringify({
    name: "@aimarket/esim-rails-check",
    version, license, engines, repository, bugs,
    type: "module",
    description: "Check the AIMarket eSIM seller contract with no runtime dependencies.",
    bin: { "esim-rails-check": "bin/esim-rails-check.mjs" },
  }, null, 2) + "\n");
  mkdirSync(destination, { recursive: true });
  execFileSync(process.execPath, [process.env.npm_execpath, "pack", "--pack-destination", destination], {
    cwd: stage,
    stdio: "inherit",
  });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
