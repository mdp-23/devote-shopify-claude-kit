// Ship gate: what Claude may and may not do with a client's Shopify store.
//
// Wired as a PreToolUse hook on Bash (see .claude/settings.json). Reads the hook
// payload on stdin and enforces four rules:
//
//   1. PUBLISH: Claude never publishes a theme, never pushes to the live theme,
//      and never deletes one. The client publishes their own shopfront. The one
//      exception: on a development store (Shopify says so, scripts/dev-store.mjs)
//      publishing and live pushes are allowed. Deleting a theme never is.
//
//   2. MERCHANT FILES: a theme push must not carry config/settings_data.json or
//      templates/*.json unless the command names them. Those hold what the
//      merchant arranged in the theme editor, and a stale copy silently reverts
//      their homepage with nothing in the CLI output to say so.
//
//   3. MERGE: a merge is what reaches the staging theme, so Claude may do it only
//      for a change whose claim to work can be checked without a person: checks
//      green, a preview link and two viewport widths for anything that renders,
//      and a "Code review: /code-review high" line in the PR body.
//
//   4. PUSH: git push must pass "npm run qa" first. A gate, not a block: pushing
//      is Claude's to do, it just has to be green. Bypass: SKIP_QA=1.
//
// Rule 1 has no escape hatch a person or Claude can set. Every other rule here has
// one, because an unbypassable guard that fires on legitimate work gets torn out.
// Rule 1 is different: it is a standing instruction about somebody else's
// shopfront, and the bypass is that a person publishes. The development-store
// exception is not an escape hatch: it is read from Shopify, so nothing in the
// repo or the command can claim it.
//
// Claude Code hooks only see Claude Code's own tool calls. What a developer runs
// in their own terminal goes through .git/hooks/pre-push instead.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { checkStore, storesInCommand } from "../dev-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Deliberately broad: any route to publishing, overwriting or deleting a theme on
// a real store. Read-only theme commands (list, pull, check, info, open) and
// "push --unpublished" stay allowed.
const PUBLISH =
  /(?:^|[;&|`(]|\s)(?:npx\s+|pnpm\s+dlx\s+|bunx\s+|yarn\s+)?shopify\s+theme\s+(?:publish|delete)\b|--live\b|--allow-live\b/;

const THEME_PUSH = /(?:^|[;&|`(]|\s)(?:npx\s+|pnpm\s+dlx\s+|bunx\s+|yarn\s+)?shopify\s+theme\s+push\b/;
const MERGE = /(?:^|[;&|]\s*)gh\s+pr\s+merge\b/;
const PUSH = /(?:^|[;&|]\s*)git\s+(?:[^;&|]*\s)?push\b/;

// A shell in command position. If one is present, every character of the command
// (heredoc bodies included) can still be executed, so the no-bypass rule keeps
// reading the whole string.
const SHELL_INVOKED = /(?:^|[;&|`(]|\s)(?:sh|bash|zsh|dash|ksh|eval|xargs|env)\s/;

/**
 * Drop heredoc bodies from a command.
 *
 * A heredoc body is stdin handed to a program, not shell for the shell to run, so
 * prose inside one is data. Without this, a "gh pr create -F -" whose body quotes
 * the live flag while explaining why nobody may use it gets denied as though it
 * were a publish.
 *
 * Only used when no shell is being invoked: a shell fed a heredoc really does
 * execute that body, so those stay checked in full. Where a line opens more than
 * one heredoc only the first terminator is tracked, so the later body survives
 * into the tested string. That fails toward blocking, which is the right way to
 * be wrong.
 */
export function withoutHeredocBodies(command) {
  const kept = [];
  let terminator = null;
  for (const line of command.split("\n")) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    kept.push(line);
    const opener = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1/);
    if (opener) terminator = opener[2];
  }
  return kept.join("\n");
}

export function executablePart(command) {
  return SHELL_INVOKED.test(command) ? command : withoutHeredocBodies(command);
}

export function isPublish(command) {
  return PUBLISH.test(executablePart(command));
}

const THEME_DELETE = /(?:^|[;&|`(]|\s)(?:npx\s+|pnpm\s+dlx\s+|bunx\s+|yarn\s+)?shopify\s+theme\s+delete\b/;

/**
 * Whether a publish or live push may go ahead: only on a development store, as Shopify reports
 * it. Every publishing step in the command must name its store with --store, because a bare one
 * goes to whatever store the CLI last used, which is not knowable here. Deleting a theme is never
 * allowed. "check" is injectable for the tests.
 * @returns {{ allow: boolean, reason: string }}
 */
export function publishVerdict(command, { check = checkStore } = {}) {
  const cmd = executablePart(command);
  if (THEME_DELETE.test(cmd)) return { allow: false, reason: "it deletes a theme, which is never allowed, development store or not" };
  const steps = cmd.split(/&&|\|\||[;&|\n`]|\$\(/).filter((step) => PUBLISH.test(step));
  const stores = new Set();
  for (const step of steps) {
    const named = storesInCommand(step);
    if (!named.length) return { allow: false, reason: "the command does not name its store with --store, so it cannot be checked as a development store" };
    named.forEach((s) => stores.add(s));
  }
  if (!stores.size) return { allow: false, reason: "no store could be read from the command" };
  for (const store of stores) {
    const r = check(store);
    if (r.error) return { allow: false, reason: `could not confirm ${store} is a development store (${r.error})` };
    if (!r.dev) return { allow: false, reason: `${store} is not a development store (Shopify says type: ${r.type ?? "none, a store we collaborate on"})` };
  }
  return { allow: true, reason: `${[...stores].join(", ")} ${stores.size > 1 ? "are development stores" : "is a development store"}` };
}

/**
 * Whether a command pushes editor-owned JSON directly: a theme push that names such files in
 * --only, or pushes a different folder with --path.
 * @param {string} cmd
 */
export function pushesEditorFilesDirectly(cmd) {
  const body = withoutHeredocBodies(cmd);
  if (!/\bshopify\s+theme\s+push\b/.test(body)) return false;
  if (/--path(=|\s)/.test(body)) return true;
  return /--only(=|\s+)['"]?(templates\/[^\s'"]*\.json|config\/settings_data\.json|sections\/[^\s'"]*\.json)/.test(body);
}

/**
 * Whether a theme push would carry the merchant's own files.
 *
 * Three ways to be safe, and the author has to have chosen one:
 *   - "--only <paths>": the push is scoped to what was named.
 *   - "--ignore" covering them on the command itself.
 *   - a .shopifyignore listing them, which is the setup this repo wants.
 *
 * Naming them in --only is the deliberate case (you pulled, you are pushing them
 * back) and is allowed. A bare theme push is the accident.
 */
export function pushesMerchantFiles(command, { root = ROOT } = {}) {
  const cmd = executablePart(command);
  if (!THEME_PUSH.test(cmd)) return false;

  const only = [...cmd.matchAll(/--only[= ]+((?:[^\s;&|]+\s*)+)/g)].map((m) => m[1]).join(" ");
  if (only.trim()) return false; // scoped: named paths are a deliberate choice either way

  if (/--ignore[= ]+[^\s;&|]*settings_data/.test(cmd)) return false;

  const ignoreFile = join(root, ".shopifyignore");
  if (existsSync(ignoreFile)) {
    try {
      if (/settings_data\.json|templates/.test(readFileSync(ignoreFile, "utf8"))) return false;
    } catch {
      /* unreadable: treat as absent, which fails toward blocking */
    }
  }
  return true;
}

// Every path whose change is visible to a shopper. Nearly all of a theme, which
// is correct: a theme PR that changed nothing visible is the rare one.
const RENDERS = /^(sections|snippets|templates|layout|blocks)\/|^assets\/.*\.(css|js|liquid)$|^locales\//;

/** Viewport widths named in the body, bounded to plausible screen sizes. */
export function verifiedWidths(body) {
  return new Set(
    [...body.matchAll(/\b(\d{3,4})\s*px\b/gi)]
      .map((m) => Number(m[1]))
      .filter((w) => w >= 320 && w <= 3840),
  );
}

/** A link to somewhere the change was actually running. */
export function previewLinked(body) {
  return /preview_theme_id=\d+|\.myshopify\.com|shopifypreview\.com/i.test(body);
}

/**
 * The code-review record a PR body must carry before it merges.
 *
 * The push hook's review agent reads one push's diff. A PR is often several
 * pushes and a rebase, so the whole thing is reviewed once more at the point it
 * lands. Like the widths above, this reads a claim rather than proving the review
 * ran: it exists so the step cannot be forgotten silently. Writing the line
 * without running the review is a lie in the PR body, not a gap in it.
 */
export const CODE_REVIEW =
  /^[ \t]*(?:[-*][ \t]+)?\**Code review:?\**[ \t]*`?\/code-review[ \t]+(high|xhigh|max|ultra)\b/im;

export function codeReviewRecorded(body) {
  return CODE_REVIEW.test(body);
}

const CHECK_OK = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/**
 * Whether Claude may merge this PR, given what GitHub reports about it.
 *
 * Pure, so the awkward combinations are answerable in a test rather than by
 * opening real pull requests. "checks" is the statusCheckRollup: anything not
 * SUCCESS/SKIPPED/NEUTRAL counts against, still-running included, because "green
 * so far" is not green.
 */
export function mergeVerdict({ files = [], body = "", checks = [] } = {}) {
  // A pull request always changes something. An empty list means the lookup told
  // us nothing, and nothing is not a pass.
  if (files.length === 0) {
    return { allow: false, reason: "GitHub reported no changed files for it, so there is nothing here to check" };
  }

  const visible = files.filter((f) => RENDERS.test(f));
  if (visible.length) {
    const shown = visible.slice(0, 3).join(", ") + (visible.length > 3 ? `, +${visible.length - 3} more` : "");

    if (!previewLinked(body)) {
      return {
        allow: false,
        reason:
          `it changes what a shopper sees (${shown}) and its body links no preview. ` +
          "Push to an unpublished theme, open the preview URL, and put it in the body",
      };
    }

    const widths = verifiedWidths(body);
    const narrow = [...widths].filter((w) => w < 768);
    const wide = [...widths].filter((w) => w >= 768);
    // Two widths, one of each kind. A change that looks right on a laptop and
    // collapses on a phone passes a one-width check, and most Shopify traffic is
    // the phone.
    if (!narrow.length || !wide.length) {
      const seen = widths.size ? `only ${[...widths].sort((a, b) => a - b).join("px, ")}px` : "no widths at all";
      return {
        allow: false,
        reason:
          `it changes what a shopper sees (${shown}) and its body names ${seen}. ` +
          "Look at the preview below 768px and above, and say so",
      };
    }
  }

  const unresolved = checks
    .map((c) => ({
      name: c.name ?? c.context ?? "check",
      state: String(c.conclusion || c.state || c.status || "").toUpperCase(),
    }))
    .filter((c) => !CHECK_OK.has(c.state));
  if (unresolved.length) {
    const shown = unresolved.map((c) => `${c.name}: ${c.state || "pending"}`).join(", ");
    return { allow: false, reason: `its checks are not all green (${shown})` };
  }

  if (!codeReviewRecorded(body)) {
    return {
      allow: false,
      reason:
        "its body has no code review line. Run the code review at high or above, fix " +
        "what it confirms, then record the level and the outcome in the body",
    };
  }

  return { allow: true };
}

export function mergeTargets(command) {
  return [...command.matchAll(/gh\s+pr\s+merge\s+(?:[^\s;&|]*\s+)*?(\d+)\b/g)].map((m) => m[1]);
}

/** Whether this repo actually has checks to run. */
export function hasQaScript({ root = ROOT } = {}) {
  try {
    return Boolean(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.scripts?.qa);
  } catch {
    return false; // no package.json, or unreadable
  }
}

const allow = () => process.exit(0);
const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
};

// Only run the hook when executed as one. The rules above are importable so they
// can be tested without feeding this process a payload on stdin.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

function main() {
  let payload = "";
  try {
    payload = readFileSync(0, "utf8");
  } catch {
    allow(); // no stdin: not a hook invocation, do not get in the way
  }

  let command = "";
  try {
    command = JSON.parse(payload)?.tool_input?.command ?? "";
  } catch {
    // An unparseable payload must not silently permit a publish. Fail closed on
    // the rule with no bypass; the push gate can fail open.
    deny(
      "Ship gate could not parse the hook payload, so it cannot confirm this is not a " +
      "theme publish. Blocked. Re-run the command on its own, or report this as a bug " +
      "in scripts/qa/ship-gate.mjs."
    );
  }

  // Rule 1: Claude never publishes, overwrites or deletes a theme, except publishing or a live
  // push on a development store.
  if (isPublish(command)) {
    // Allowed on a development store, and the rules below (merchant files, QA) still apply.
    const verdict = publishVerdict(command);
    if (!verdict.allow) deny(
      "BLOCKED. Claude does not publish, overwrite or delete a theme on a client's " +
      "store. The live theme is somebody's shopfront and the client decides when it " +
      `changes. Here, ${verdict.reason}.\n\n` +
      "Do not retry, do not reword the command, and do not look for another route to " +
      "the same effect. Push to an unpublished theme instead, hand over the preview " +
      "URL, and let them press publish. (On a development store, which Shopify must " +
      "confirm, publishing and live pushes are allowed. Deleting a theme never is.)\n\n" +
      "If you were only quoting the command inside a message or a file, put that text " +
      "in a heredoc body: those are not read as invocations."
    );
  }

  // Rule 2a: editor-owned files only ever travel through npm run deploy, which pulls first and
  // refuses to overwrite editor changes. Naming them in --only, or pushing from another folder
  // with --path, goes around .shopifyignore and around that check. On 30 Sep 2026 a homepage
  // template was pushed that way minutes after the client had edited it in the editor.
  if (pushesEditorFilesDirectly(command)) {
    deny(
      "Push blocked. Template and settings JSON (templates/*.json, config/settings_data.json, " +
      "sections/*.json) hold work people do in the theme editor. Push them only with " +
      "`npm run deploy -- --with-json`: it pulls the theme first and refuses if anyone has " +
      "edited it since your last sync. Do not push them from another folder or with --only."
    );
  }

  // Rule 2: a push must not carry the merchant's own files
  if (pushesMerchantFiles(command)) {
    deny(
      "Push blocked. This would upload config/settings_data.json and templates/*.json " +
      "along with your changes. Those files hold what the merchant arranged in the " +
      "theme editor, and pushing a stale copy silently reverts their homepage, their " +
      "colours and every section they moved. Nothing in the CLI output would say so.\n\n" +
      "Do one of these, then run it again:\n" +
      "  1. Add a .shopifyignore listing config/settings_data.json and templates/*.json " +
      "(the setup this repo wants, so nobody has to remember).\n" +
      "  2. Scope the push with --only, naming the files you changed.\n" +
      "  3. If pushing those files IS the change, pull them first, then name them " +
      "explicitly with --only."
    );
  }

  // Rule 3: only merges Claude can vouch for
  if (MERGE.test(executablePart(command))) {
    const targets = mergeTargets(executablePart(command));
    const pr = targets[0];
    if (!pr) {
      deny(
        "Merge blocked. No PR number in the command, so the gate cannot tell which " +
        "pull request this is. Pass one explicitly."
      );
    }
    if (new Set(targets).size > 1) {
      deny(
        `Merge blocked. This command merges more than one pull request (${[...new Set(targets)].join(", ")}). ` +
        "The gate checks each PR individually, so run them as separate commands."
      );
    }

    let meta;
    try {
      const raw = execSync(`gh pr view ${pr} --json files,body,statusCheckRollup`, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
      meta = JSON.parse(raw);
    } catch (e) {
      deny(
        `Merge blocked. Could not read PR ${pr} to check it against the merge rule: ` +
        `${String(e.message).split("\n")[0]}\n\nBeing unable to check is not permission to proceed.`
      );
    }

    const verdict = mergeVerdict({
      files: (meta.files ?? []).map((f) => f.path),
      body: meta.body ?? "",
      checks: meta.statusCheckRollup ?? [],
    });

    if (!verdict.allow) {
      deny(
        `Merge blocked. Claude may not merge PR ${pr}, because ${verdict.reason}.\n\n` +
        "Do not reword the command, and do not merge through another route. Every " +
        "reason above is work this session can do: do the missing part, then run the " +
        "merge again. It is not a reason to hand the merge to somebody else."
      );
    }
  }

  // Rule 4: pushes must be green
  if (!PUSH.test(command)) allow();
  if (process.env.SKIP_QA === "1") {
    process.stdout.write(JSON.stringify({
      systemMessage: "Pre-push checks SKIPPED (SKIP_QA=1): pushing unchecked.",
    }));
    process.exit(0);
  }

  // No qa script means no checks to run, and a missing check must not report a
  // pass. Allow the push, say plainly that nothing was verified. Blocking here
  // instead would stop every push in a repo nobody has set the scripts up in,
  // which is how a gate gets removed.
  if (!hasQaScript()) {
    process.stdout.write(JSON.stringify({
      systemMessage:
        "No `qa` script in package.json, so NOTHING WAS CHECKED before this push. " +
        "Add one (see package.json.example) or say in the PR that no checks ran.",
    }));
    process.exit(0);
  }

  const failures = [];
  for (const script of ["qa"]) {
    try {
      execSync(`npm run ${script}`, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
      failures.push(`npm run ${script} FAILED:\n${out}`);
    }
  }

  if (failures.length === 0) allow();

  deny(
    `Push blocked. ${failures.length} check(s) failed:\n\n` +
    failures.map((f, i) => `${i + 1}. ${f}`).join("\n\n") +
    `\n\nFix these, then push again. To push anyway (say so to the user first): ` +
    `prefix the command with SKIP_QA=1.`
  );
}
