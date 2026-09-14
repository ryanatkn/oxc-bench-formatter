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
// where review sees it, rather than only in ./data's commit message.

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

// .svelte files across those collections at the pinned tree.
export const EXPECTED_FILES = 2226;

// What the snapshot's commit message records, and the line the pin is read back
// from. Kept as one regex so writer and reader can't drift.
const PIN_LINE = /^fuzdev\/corpora@([0-9a-f]{40}) collections ([0-9a-f]{40})$/m;

export function formatPinLine(commit, tree) {
  return `fuzdev/corpora@${commit} collections ${tree}`;
}

/**
 * The corpora commit and tree a ./data snapshot was built from, read from its
 * commit message — or null when it isn't a git repo or predates the pin line.
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
  return match ? { commit: match[1], tree: match[2] } : null;
}

export function describePin(commit = CORPORA_COMMIT, tree = CORPORA_TREE) {
  return `fuzdev/corpora@${commit.slice(0, 12)} (collections tree ${tree.slice(0, 12)})`;
}
