// The one place bench-svelte's corpus is pinned. setup-corpus.mjs builds
// ./data from it; bench.mjs refuses a ./data that wasn't.
//
// Two ids, on purpose: the commit is what a reader FETCHES (GitHub serves a
// fetch by full SHA, and it's the roll-up a human can look up), but what the
// corpus IS is the `collections/` tree id — a docs or scripts commit in corpora
// moves the commit and not the tree, and it's the tree that tsv's own gates pin
// (`GATE_CHECKOUT_IDS`). Recording both lets setup-corpus assert the commit it
// fetched really carries the tree this file names, so "same bytes as tsv's
// corpus" is a check, not a claim.
//
// Moving the corpus: set CORPORA_COMMIT to the new roll-up, CORPORA_TREE to
// `git rev-parse <commit>:collections`, and EXPECTED_FILES to the count the
// refused rebuild reports — a pin bump that changes the file count has to say so here,
// where review sees it, rather than only in ./data's commit message. Narrowing a
// collection (SUBPATHS) moves the bytes without moving either id, so the snapshot
// records the selection beside them and a change to it forces a rebuild too.

import { execFileSync } from "child_process";

export const CORPORA_URL = "https://github.com/fuzdev/corpora.git";
export const CORPORA_COMMIT = "1117b4829309e4c3647eb2e8c3cdd34a993eb217";
export const CORPORA_TREE = "5f40c547c3ed8f90003c601c82336ccee9ec3901";

// The seven collections read out of that tree — every third-party Svelte
// source corpora vendors (kit, svelte.dev, and five component libraries).
// `svelte` itself is absent on purpose: its packages/svelte/src is the
// compiler, which contains no .svelte files.
export const COLLECTIONS = [
  "kit",
  "svelte.dev",
  "layerchart",
  "svelte-ux",
  "flowbite-svelte",
  "svelte-maplibre",
  "layercake",
];

// Collections narrowed to some of their subpaths (relative to the collection's
// root); every other one contributes all its .svelte files. corpora vendors as
// much real code as it can, for tsv's correctness sweeps; choosing a mix that no
// one source dominates is this consumer's job.
export const SUBPATHS = {
  // Its library only. Its src/routes is the docs site, mostly near-duplicate
  // docs-example snippets in the library's one house style: whole, the collection
  // was over half the corpus's files and drowned out the other sources' styles.
  "flowbite-svelte": ["src/lib"],
};

// SUBPATHS as one token, recorded in the snapshot's pin line.
export const SELECTION =
  Object.entries(SUBPATHS)
    .map(([name, subpaths]) => `${name}:${subpaths.join("+")}`)
    .sort()
    .join(",") || "all";

// .svelte files across those collections at the pinned tree, after SUBPATHS.
export const EXPECTED_FILES = 1113;

// What the snapshot's commit message records, and the line the pin is read back
// from. Kept as one regex so writer and reader can't drift. The selection is
// optional so a snapshot from before SUBPATHS reads back as one with none.
const PIN_LINE = /^fuzdev\/corpora@([0-9a-f]{40}) collections ([0-9a-f]{40})(?: select (\S+))?$/m;

export function formatPinLine(commit, tree, selection) {
  return `fuzdev/corpora@${commit} collections ${tree} select ${selection}`;
}

/**
 * The corpora commit, tree, and selection a ./data snapshot was built from, read
 * from its commit message — or null when it isn't a git repo or predates the pin line.
 */
export function readSnapshotPin(dataDir) {
  let message;
  try {
    message = execFileSync("git", ["-C", dataDir, "log", "-1", "--format=%B"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const match = PIN_LINE.exec(message);
  return match ? { commit: match[1], tree: match[2], selection: match[3] ?? "all" } : null;
}

/** Whether a snapshot pin (from `readSnapshotPin`) is the one this file names. */
export function isCurrentPin(built) {
  return (
    built?.commit === CORPORA_COMMIT && built.tree === CORPORA_TREE && built.selection === SELECTION
  );
}

export function describePin(commit = CORPORA_COMMIT, tree = CORPORA_TREE) {
  return `fuzdev/corpora@${commit.slice(0, 12)} (collections tree ${tree.slice(0, 12)})`;
}

/** A snapshot pin with its selection, for the messages that refuse a stale one. */
export function describeSnapshotPin(built) {
  return built
    ? `${describePin(built.commit, built.tree)}, select ${built.selection}`
    : "an older setup-corpus (no pin recorded)";
}

/** The collections as the scenario's Target line names them, narrowed ones with their subpaths. */
export function describeCollections() {
  return COLLECTIONS.map((name) =>
    SUBPATHS[name] ? `${name} ${SUBPATHS[name].join("+")}` : name,
  ).join(", ");
}
