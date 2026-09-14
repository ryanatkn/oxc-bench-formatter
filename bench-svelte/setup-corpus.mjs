#!/usr/bin/env node

// Builds the bench-svelte corpus: a .svelte-only snapshot of seven third-party
// sources, committed into ./data as its own git repo.
//
// The sources are collections of the fuzdev/corpora snapshot, read at ONE
// pinned commit (./corpora-pin.mjs) straight out of git's object store — never
// from a working tree — so a rebuild reproduces the same bytes whatever any
// checkout currently has checked out, and moving the corpus is a reviewable pin
// bump. Where those objects come from, in order:
//   1. $CORPORA_DIR, if set — any clone that has the pinned commit.
//   2. The sibling ../corpora checkout, if there is one (the workspace default).
//   3. Otherwise a depth-1 fetch of the pinned commit from GitHub into the
//      gitignored ./corpora cache — how this builds on CI or a fresh machine.
// The pinned commit is also checked to carry the pinned `collections/` tree id,
// which is what the corpus actually is (a docs commit in corpora moves the
// commit and not the tree) and what tsv's own gates pin — so this bench and
// tsv's benchmark corpus being the same bytes is asserted, not assumed.
//
// Why a snapshot instead of formatting the checkout in place: the two
// formatters discover files differently (tsv is config-free and
// gitignore-aware; rsvelte-fmt walks .svelte in-process and hands everything
// else to oxfmt, which would pick up .json/.md/etc), so a tree containing ONLY
// the corpus files is the one way to pin both to the same set. The `git init`
// makes ./data its own git root, which keeps the outer .gitignore out of
// tsv's discovery, and it gives the bench its reset-per-run baseline.
//
// The snapshot commit is deterministic — fixed author, the corpora commit's
// own date, and a message made of the pin plus per-collection provenance — so
// identical corpus bytes give an identical snapshot SHA on every machine, and
// two READMEs can be compared on the `Corpus:` line they print.
//
// Every collection is checked to be shaped by a formatter that isn't benched
// here (the manifest's `shaped_by`): a formatter measured on code it already
// shaped measures its no-op path. The snapshot already leaves each upstream's
// test fixtures behind, so the only filter left here is the extension.
//
// Idempotent: exits early if ./data exists at the current pin, and refuses to
// run over a ./data built at an older one. Delete ./data to regenerate. The
// tree is built in ./data.tmp and renamed into place last, so an interrupted
// build never leaves a half-written ./data that looks like a corpus.

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import {
  COLLECTIONS,
  CORPORA_COMMIT,
  CORPORA_TREE,
  CORPORA_URL,
  EXPECTED_FILES,
  describePin,
  formatPinLine,
  readSnapshotPin,
} from "./corpora-pin.mjs";

process.chdir(dirname(fileURLToPath(import.meta.url)));

const dataDir = "./data";
const stagingDir = "./data.tmp";
// The fetch cache (source 3 above); gitignored.
const cacheDir = resolve("./corpora");
const siblingDir = resolve("../../corpora");

// Formatters benched by bench.mjs, as corpora's manifest would name them.
const BENCHED_FORMATTERS = new Set(["tsv", "rsvelte-fmt"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    ...options,
    env: {
      ...process.env,
      // Every path handed to git here is a literal one from its own tree
      // listing, never a pattern — and SvelteKit route names like `[slug]` and
      // `[...rest]` are pathspec wildcards, so say so rather than lean on git
      // trying a literal match before the glob.
      GIT_LITERAL_PATHSPECS: "1",
      ...options.env,
    },
  });
}

function hasCommit(repoDir, commit) {
  try {
    git(["-C", repoDir, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Where to read the pinned commit's objects from — see the header.
function resolveCorporaRepo() {
  if (process.env.CORPORA_DIR) {
    const dir = resolve(process.env.CORPORA_DIR);
    if (!existsSync(join(dir, ".git"))) {
      fail(`CORPORA_DIR=${dir} is not a git checkout`);
    }
    if (!hasCommit(dir, CORPORA_COMMIT)) {
      fail(`${dir} does not have commit ${CORPORA_COMMIT} — run \`git -C ${dir} fetch\``);
    }
    return dir;
  }
  if (existsSync(join(siblingDir, ".git"))) {
    if (!hasCommit(siblingDir, CORPORA_COMMIT)) {
      // A sibling that's behind is the user's checkout to move, not this
      // script's to fetch into — say so instead of quietly using the cache.
      fail(
        `${siblingDir} does not have commit ${CORPORA_COMMIT} — run \`git -C ${siblingDir} fetch\`, or point CORPORA_DIR at a clone that has it`,
      );
    }
    return siblingDir;
  }
  if (!existsSync(join(cacheDir, ".git"))) {
    console.log(`No ${siblingDir} checkout; fetching corpora into ${cacheDir}...`);
    git(["init", "-q", cacheDir]);
  }
  if (!hasCommit(cacheDir, CORPORA_COMMIT)) {
    console.log(`Fetching fuzdev/corpora@${CORPORA_COMMIT.slice(0, 12)} into ${cacheDir}...`);
    git(["-C", cacheDir, "fetch", "-q", "--depth=1", CORPORA_URL, CORPORA_COMMIT], {
      stdio: "inherit",
    });
  }
  return cacheDir;
}

function main() {
  if (existsSync(dataDir)) {
    const built = readSnapshotPin(dataDir);
    if (built?.commit === CORPORA_COMMIT && built.tree === CORPORA_TREE) {
      console.log(
        `bench-svelte corpus already exists at ${describePin()} (delete ./data to regenerate)`,
      );
      return;
    }
    fail(
      `bench-svelte corpus exists but was built from ${
        built ? describePin(built.commit, built.tree) : "an older setup-corpus (no pin recorded)"
      }; the pin is now ${describePin()}. Delete ./data and rerun to rebuild it.`,
    );
  }

  const corporaDir = resolveCorporaRepo();

  const tree = git(["-C", corporaDir, "rev-parse", `${CORPORA_COMMIT}:collections`]).trim();
  if (tree !== CORPORA_TREE) {
    fail(
      `corpora@${CORPORA_COMMIT.slice(0, 12)} carries collections tree ${tree.slice(0, 12)}, but corpora-pin.mjs pins ${CORPORA_TREE.slice(0, 12)} — one of the two ids is stale`,
    );
  }

  // The manifest at the pinned commit names each collection's upstream commit
  // (the provenance the corpus commit records) and who shaped its code.
  const manifest = JSON.parse(git(["-C", corporaDir, "show", `${CORPORA_COMMIT}:manifest.json`]));
  const byName = new Map(manifest.collections.map((c) => [c.name, c]));

  // One throwaway index per collection: read-tree fills it from the
  // collection's subtree, ls-files lists it (paths relative to that subtree, no
  // argv of file names anywhere), and checkout-index writes the chosen files
  // under ./data/<name>/. Pure git, so it works the same on the sibling checkout
  // and the fetch cache — and never touches either one's real index. The
  // subtree carries no .gitattributes, so line endings are pinned by config
  // instead: corpus bytes are verbatim upstream, never converted.
  const indexDir = mkdtempSync(join(tmpdir(), "bench-svelte-index-"));
  process.on("exit", () => rmSync(indexDir, { recursive: true, force: true }));
  const corporaGit = (name, args, options = {}) =>
    git(["-C", corporaDir, "-c", "core.autocrlf=false", "-c", "core.eol=lf", ...args], {
      ...options,
      env: { GIT_INDEX_FILE: join(indexDir, name), ...options.env },
    });

  // List every collection before writing any of it, so a pin that moved the
  // file count fails with nothing on disk.
  const listed = COLLECTIONS.map((name) => {
    const collection = byName.get(name);
    if (!collection) {
      fail(`corpora@${CORPORA_COMMIT.slice(0, 12)} has no collection named ${name}`);
    }
    if (BENCHED_FORMATTERS.has(collection.shaped_by)) {
      fail(
        `Collection ${name} is shaped by ${collection.shaped_by}, which this scenario benches — a formatter measured on code it already shaped measures its no-op path`,
      );
    }
    corporaGit(name, ["read-tree", `${CORPORA_COMMIT}:collections/${name}`]);
    const paths = corporaGit(name, ["ls-files", "-z"])
      .split("\0")
      .filter((p) => p.endsWith(".svelte"))
      .sort();
    if (paths.length === 0) {
      fail(`Collection ${name} contributed no .svelte files — did its layout change?`);
    }
    return { name, collection, paths };
  });
  const total = listed.reduce((sum, { paths }) => sum + paths.length, 0);
  if (total !== EXPECTED_FILES) {
    fail(
      `${describePin()} yields ${total} .svelte files, but corpora-pin.mjs expects ${EXPECTED_FILES} — if the pin moved on purpose, update EXPECTED_FILES with it`,
    );
  }

  console.log(`Copying .svelte files from ${corporaDir} at ${describePin()}...`);
  rmSync(stagingDir, { recursive: true, force: true });
  const provenance = [];
  for (const { name, collection, paths } of listed) {
    // Keep the upstream-relative layout: data/<name>/<subpath>/<relative>.
    const dest = resolve(stagingDir, name);
    mkdirSync(dest, { recursive: true });
    corporaGit(name, ["checkout-index", "-z", "--stdin", `--prefix=${dest}/`], {
      input: paths.join("\0"),
    });
    provenance.push(
      `${name}@${collection.commit.slice(0, 12)} ${collection.subpaths.join("+")} (${paths.length} files)`,
    );
    console.log(`  ${provenance[provenance.length - 1]}`);
  }

  // A deterministic snapshot commit (see the header): same bytes, same SHA.
  const date = git(["-C", corporaDir, "log", "-1", "--format=%cI", CORPORA_COMMIT]).trim();
  const snapshotEnv = {
    GIT_AUTHOR_NAME: "bench",
    GIT_AUTHOR_EMAIL: "bench@localhost",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: "bench",
    GIT_COMMITTER_EMAIL: "bench@localhost",
    GIT_COMMITTER_DATE: date,
  };
  const snapshotGit = (args) =>
    git(["-C", stagingDir, "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
      env: snapshotEnv,
    });
  git(["init", "-q", stagingDir]);
  snapshotGit(["add", "-A"]);
  snapshotGit([
    "commit",
    "-q",
    "-m",
    `svelte corpus: ${total} .svelte files\n\n${formatPinLine(CORPORA_COMMIT, CORPORA_TREE)}\n${provenance.join("\n")}`,
  ]);
  const snapshot = snapshotGit(["rev-parse", "--short=12", "HEAD"]).trim();
  renameSync(stagingDir, dataDir);
  console.log(`Svelte corpus ready: ${total} .svelte files in ${dataDir} (snapshot ${snapshot})`);
}

main();
