// @ts-check
// A scored test run, pinned to one commit of the app. This is the only way to score the
// held-out set:
//
//   node eval/scored.mjs --commit <sha> --label <label> [--note "..."] [--fast]
//   node eval/scored.mjs --commit <sha> --label <label> --check-pin   (a dry run: pin, verify, stop)
//   node eval/scored.mjs --commit <sha> --record [--set test|dev] [--llm-cap N]
//        a fill-only recording pass against the same pinned commit (no scoring, no label);
//        add --check-pin for a dry run with no Gemma call
//
// It checks out <sha> into a clean, detached git worktree (outside the repo), so the app
// under test is exactly that commit's src/, data/ and package.json, whatever is in anyone's
// working tree. The harness (eval/*.mjs and the frozen personas) is this checkout's, and must
// be committed: its commit is recorded too. The world, the results and the run folders are
// shared with this checkout by symlink, as are node_modules and .env (the Gemma key).
// run.mjs then checks, from inside the worktree, that HEAD is <sha> and that nothing outside
// eval/ differs from it, writes "clean: true" with both commits into the report, and refuses
// to score otherwise. The worktree is removed afterwards.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (/** @type {string} */ f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};
const die = (/** @type {string} */ m) => {
  console.error(m);
  process.exit(2);
};
const git = (/** @type {string[]} */ args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const commitArg = opt("--commit");
const label = opt("--label");
const recording = argv.includes("--record");
if (!commitArg) die("Pin the app: --commit <sha>.");
if (!recording && !label) die("Label the scored run: --label <label>.");
let sha;
try {
  sha = git(["rev-parse", "--verify", `${commitArg}^{commit}`]);
} catch {
  die(`Unknown commit ${commitArg}. Fetch it first (git fetch origin).`);
}

// the harness must be committed, so the report can say which harness scored the app
const harnessDirty = git(["status", "--porcelain", "--", "eval", ":(exclude)eval/world", ":(exclude)eval/results", ":(exclude)eval/.runs"]);
if (harnessDirty) die(`Commit the harness first; these eval/ files differ from HEAD:\n${harnessDirty}`);
const harness = git(["rev-parse", "HEAD"]);

const wt = fs.mkdtempSync(path.join(os.tmpdir(), `comethrough-${sha.slice(0, 7)}-`));
fs.rmdirSync(wt);
git(["worktree", "add", "--detach", wt, sha]);
let code = 1;
try {
  if (git(["status", "--porcelain"], wt)) die("The new worktree is not clean.");
  // this checkout's harness over the commit's eval/, sharing the world, the results and the runs
  const ev = path.join(wt, "eval");
  for (const entry of fs.readdirSync(path.join(ROOT, "eval"))) {
    if (["world", "results", ".runs"].includes(entry)) continue;
    fs.rmSync(path.join(ev, entry), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, "eval", entry), path.join(ev, entry), { recursive: true });
  }
  for (const shared of ["world", "results", ".runs"]) {
    fs.mkdirSync(path.join(ROOT, "eval", shared), { recursive: true });
    fs.rmSync(path.join(ev, shared), { recursive: true, force: true });
    fs.symlinkSync(path.join(ROOT, "eval", shared), path.join(ev, shared));
  }
  for (const shared of ["node_modules", ".env"]) if (fs.existsSync(path.join(ROOT, shared))) fs.symlinkSync(path.join(ROOT, shared), path.join(wt, shared));
  // everything but --commit, --set and --record passes through
  const rest = argv.filter((a, i) => !["--commit", "--set", "--record"].includes(a) && !["--commit", "--set"].includes(argv[i - 1]));
  const args = recording
    ? [path.join(ev, "run.mjs"), "--set", opt("--set") || "test", "--record", ...rest]
    : [path.join(ev, "run.mjs"), "--set", "test", "--replay", "--scored", ...rest];
  console.error(`${recording ? `recording (fill only) the ${opt("--set") || "test"} set` : "scoring the held-out set"} against ${sha} (clean worktree ${wt}), harness ${harness.slice(0, 7)}`);
  const r = spawnSync(process.execPath, args, { cwd: wt, stdio: "inherit", env: { ...process.env, EVAL_PINNED: sha, EVAL_HARNESS: harness } });
  code = r.status ?? 1;
} finally {
  // the shared folders are links: unlink them first, so removing the worktree can never touch them
  for (const l of ["eval/world", "eval/results", "eval/.runs", "node_modules", ".env"]) {
    try {
      if (fs.lstatSync(path.join(wt, l)).isSymbolicLink()) fs.unlinkSync(path.join(wt, l));
    } catch {}
  }
  try {
    git(["worktree", "remove", "--force", wt]);
  } catch (e) {
    console.error(`could not remove the worktree ${wt}: ${/** @type {any} */ (e).message}`);
  }
}
process.exit(code);
