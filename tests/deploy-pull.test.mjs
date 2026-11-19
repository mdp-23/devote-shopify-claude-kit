// deploy --pull with no record of the last sync must never write over a file the repo already has.
//
// Exists because on Windows (Nov 2026) the first --pull to a fresh duplicate of live replaced a
// developer's uncommitted code with the theme's copies and said "Someone else changed these on the
// theme", when nobody had. Runs the real deploy.mjs against a fake Shopify CLI, installed the way
// npm installs the real one (a shim beside node_modules/@shopify/cli/bin/run.js), so the same test
// also covers how scripts/platform.mjs starts the CLI on Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FAKE_CLI = `
const { cpSync, mkdirSync, readdirSync, statSync } = require("node:fs");
const { dirname, join, relative } = require("node:path");
const a = process.argv.slice(2);
const opt = (n) => a[a.indexOf(n) + 1];
if (a[0] === "theme" && a[1] === "list") { console.log(JSON.stringify([{ id: 1, role: "live" }])); process.exit(0); }
if (a[0] === "theme" && a[1] === "pull") {
  const only = a.flatMap((x, i) => (x === "--only" ? [a[i + 1]] : []));
  const re = only.map((g) => new RegExp("^" + g.replace(/[.]/g, "\\\\.").replace(/\\*/g, "[^/]*") + "$"));
  const src = process.env.FAKE_THEME, dest = opt("--path");
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(src)) {
    const rel = relative(src, f).split("\\\\").join("/");
    if (re.some((r) => r.test(rel))) { mkdirSync(dirname(join(dest, rel)), { recursive: true }); cpSync(f, join(dest, rel)); }
  }
  process.exit(0);
}
console.error("fake shopify: not handled: " + a.join(" "));
process.exit(1);
`;

function put(root, files) {
  for (const [f, body] of Object.entries(files)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), body); }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "deploy-pull-"));
  const repo = join(dir, "repo"), theme = join(dir, "theme"), bin = join(dir, "bin");
  // The kit's code only. A brand repo's *-baseline.json files point at its own history (a "from"
  // commit), which this temporary repo does not have, so every guard failed there (Nov 2026).
  cpSync(join(KIT, "scripts"), join(repo, "scripts"), { recursive: true, filter: (src) => !src.endsWith("-baseline.json") });
  const runJs = join(bin, "node_modules", "@shopify", "cli", "bin", "run.js");
  put(bin, { [join("node_modules", "@shopify", "cli", "bin", "run.js")]: FAKE_CLI });
  writeFileSync(join(bin, "shopify"), `#!/bin/sh\nexec "${process.execPath}" "${runJs}" "$@"\n`);
  chmodSync(join(bin, "shopify"), 0o755);
  writeFileSync(join(bin, "shopify.cmd"), `@"${process.execPath}" "%~dp0node_modules\\@shopify\\cli\\bin\\run.js" %*\r\n`);
  const env = { ...process.env, FAKE_THEME: theme, PATH: bin + delimiter + (process.env.PATH ?? process.env.Path ?? "") };
  delete env.Path;
  const pull = () => spawnSync(process.execPath, [join(repo, "scripts", "deploy.mjs"), "--store", "acme.myshopify.com", "--theme", "2", "--pull"], { cwd: repo, env, encoding: "utf8" });
  return { dir, repo, theme, pull };
}

test("first --pull keeps your changed code and puts the theme's copy in .theme-incoming/", () => {
  const { dir, repo, theme, pull } = setup();
  try {
    put(theme, { "sections/a.liquid": "theirs", "sections/b.liquid": "same", "snippets/new.liquid": "only on theme", "templates/index.json": "{}" });
    put(repo, { "sections/a.liquid": "mine, not committed", "sections/b.liquid": "same", "templates/index.json": "{}" });
    const r = pull();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(readFileSync(join(repo, "sections/a.liquid"), "utf8"), "mine, not committed");
    assert.equal(readFileSync(join(repo, ".theme-incoming/sections/a.liquid"), "utf8"), "theirs");
    assert.equal(readFileSync(join(repo, "snippets/new.liquid"), "utf8"), "only on theme");
    assert.doesNotMatch(r.stdout, /Someone else changed/);
    // Merged and cleared: the theme as pulled is now the last sync, so your file counts as yours.
    rmSync(join(repo, ".theme-incoming"), { recursive: true });
    const again = pull();
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal(readFileSync(join(repo, "sections/a.liquid"), "utf8"), "mine, not committed");
    assert.ok(!existsSync(join(repo, ".theme-incoming")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("first --pull keeps your template JSON too", () => {
  const { dir, repo, theme, pull } = setup();
  try {
    put(theme, { "sections/a.liquid": "same", "templates/index.json": '{"theme":1}', "templates/page.json": '{"page":1}' });
    put(repo, { "sections/a.liquid": "same", "templates/index.json": '{"mine":1}' });
    const r = pull();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(readFileSync(join(repo, "templates/index.json"), "utf8"), '{"mine":1}');
    assert.equal(readFileSync(join(repo, ".theme-incoming/templates/index.json"), "utf8"), '{"theme":1}');
    assert.equal(readFileSync(join(repo, "templates/page.json"), "utf8"), '{"page":1}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with a record of the last sync, --pull still brings in what only the theme changed", () => {
  const { dir, repo, theme, pull } = setup();
  try {
    put(theme, { "sections/a.liquid": "v1", "templates/index.json": "{}" });
    put(repo, { "sections/a.liquid": "v1", "templates/index.json": "{}" });
    assert.equal(pull().status, 0);
    put(theme, { "sections/a.liquid": "v2 from someone else" });
    const r = pull();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(repo, "sections/a.liquid"), "utf8"), "v2 from someone else");
    assert.match(r.stdout, /Someone else changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
