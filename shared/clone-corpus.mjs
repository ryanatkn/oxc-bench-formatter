#!/usr/bin/env node
// Clone one corpus at its pinned commit: `node ./shared/clone-corpus.mjs
// bench-ts-only/data`. What init.sh runs in place of `git clone --depth=1`,
// which takes whatever the default branch points at that day.
//
// A depth-1 fetch of the commit itself — GitHub serves a fetch by full SHA — so
// it costs what the shallow clone did. The result is a git repo with the pinned
// commit checked out, which the scenarios need twice over: their per-run reset
// is git's (`resetCorpusCommand` in ./utils.mjs), and being its own repo is what
// keeps tsv's discovery from reading this repo's .gitignore.

import { execFileSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { CORPUS_PINS } from "./corpus-pins.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
const pin = CORPUS_PINS.find((p) => p.dir === dir);
if (!pin) {
  console.error(
    `clone-corpus: no pin for "${dir}" — expected one of: ${CORPUS_PINS.map((p) => p.dir).join(", ")}`,
  );
  process.exit(1);
}

const target = join(projectRoot, pin.dir);
if (existsSync(target)) {
  console.error(`clone-corpus: ${pin.dir} already exists — remove it to clone again`);
  process.exit(1);
}

const git = (args) => execFileSync("git", args, { stdio: "inherit" });
try {
  git(["-c", "init.defaultBranch=main", "init", "-q", target]);
  git(["-C", target, "remote", "add", "origin", pin.url]);
  git(["-C", target, "fetch", "-q", "--depth=1", "origin", pin.commit]);
  git(["-C", target, "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"]);
} catch {
  // leave nothing behind: a half-made data/ would make init.sh skip the clone
  // next time
  rmSync(target, { recursive: true, force: true });
  console.error(`clone-corpus: could not fetch ${pin.url} at ${pin.commit}`);
  process.exit(1);
}
console.log(`Cloned ${pin.dir} at ${pin.commit.slice(0, 7)}`);
