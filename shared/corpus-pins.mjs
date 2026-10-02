// The one place the cloned corpora are pinned. init.sh clones each at its commit
// (through ./clone-corpus.mjs), and the readiness check in ./utils.mjs refuses a
// run whose checkout is at any other — so two runs months apart format the same
// bytes, and the two outline checkouts can't land on different commits.
//
// The CI workflows repeat these SHAs as `ref:` on their checkout steps, since a
// workflow can't read this file before it has checked anything out. A workflow
// left behind by a bump here fails its `./init.sh` step on that same readiness
// check rather than benchmarking the wrong corpus.
//
// Moving a corpus: set its commit here and in both workflows, then
// `rm -rf <dir>` and rerun ./init.sh. The numbers that follow are for a different
// corpus, so regenerate the README as a whole rather than comparing across the
// bump. bench-svelte's corpus is pinned separately, in
// ../bench-svelte/corpora-pin.mjs.

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const OUTLINE = {
  url: "https://github.com/outline/outline.git",
  commit: "8cf997c5ce0ce99721f44804f58d44c05ba8b0fc",
};

export const CORPUS_PINS = [
  { dir: "bench-js-no-embedded/data", ...OUTLINE },
  {
    dir: "bench-mixed-embedded/data",
    url: "https://github.com/storybookjs/storybook.git",
    commit: "5073688f5836ec16575855550ffbeb3e81ab1cf1",
  },
  {
    dir: "bench-full-features/data",
    url: "https://github.com/continuedev/continue.git",
    commit: "d0a3c0b626b5bebc3bef4742eec05a0242be0bab",
  },
  { dir: "bench-ts-only/data", ...OUTLINE },
];

/**
 * The cloned corpora that exist but aren't at their pinned commit, one line
 * each; empty when every present checkout matches. A missing checkout is not
 * reported here — that is `missingBenchSetup`'s own line.
 */
export function unpinnedCorpora(projectRoot = ".") {
  const lines = [];
  for (const { dir, commit } of CORPUS_PINS) {
    const path = join(projectRoot, dir);
    if (!existsSync(path)) continue;
    // --git-dir is pinned so a data/ with no .git of its own can't answer with
    // this repo's HEAD
    const head = spawnSync("git", ["--git-dir", join(path, ".git"), "rev-parse", "HEAD"], {
      encoding: "utf8",
    });
    const at = head.status === 0 ? head.stdout.trim() : null;
    if (at === commit) continue;
    lines.push(
      `${dir} — ${at ? `at ${at.slice(0, 7)}` : "not a git checkout"}, pinned to ${commit.slice(0, 7)} (rm -rf ${dir}, then ./init.sh)`,
    );
  }
  return lines;
}
