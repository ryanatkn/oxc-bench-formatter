#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync } from "fs";

import {
  benchRows,
  benchRunCounts,
  checkGnuTime,
  createFormatters,
  describeCorpus,
  printHeader,
  setupCwd,
} from "../shared/utils.mjs";
import {
  COLLECTIONS,
  CORPORA_COMMIT,
  CORPORA_TREE,
  describePin,
  readSnapshotPin,
} from "./corpora-pin.mjs";

const [WARMUP_RUNS, BENCHMARK_RUNS] = benchRunCounts(2, 5);

async function main() {
  setupCwd(import.meta.url);

  const dataDir = "./data";
  const projectRoot = "..";
  const formatters = createFormatters(projectRoot, ".");

  printHeader("Benchmarking Svelte (tsv vs rsvelte-fmt)");

  checkGnuTime();

  console.log("");
  // This is the one corpus init.sh doesn't clone — setup-corpus.mjs builds it
  // from the pinned fuzdev/corpora snapshot — so name the fix instead of failing
  // inside `git reset` with "not a git repository".
  if (!existsSync(`${dataDir}/.git`)) {
    console.error(
      "bench-svelte corpus missing. Build it with `node ./bench-svelte/setup-corpus.mjs` (reads ../corpora if present, else fetches the pinned commit from GitHub).",
    );
    process.exit(1);
  }
  // And refuse a corpus built at some other pin: the pin in corpora-pin.mjs is
  // what these numbers claim to describe, and setup-corpus only ever builds a
  // MISSING ./data, so a bumped pin over an old snapshot would be timed as-is.
  const built = readSnapshotPin(dataDir);
  if (built?.commit !== CORPORA_COMMIT || built.tree !== CORPORA_TREE) {
    console.error(
      `bench-svelte corpus was built from ${
        built ? describePin(built.commit, built.tree) : "an older setup-corpus (no pin recorded)"
      }, but corpora-pin.mjs pins ${describePin()}. Rebuild it: rm -rf bench-svelte/data && node ./bench-svelte/setup-corpus.mjs`,
    );
    process.exit(1);
  }

  const prepareCmd = `git -C ${dataDir} reset --hard`;

  // Reset before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  console.log(`Target: third-party .svelte corpus (${COLLECTIONS.join(", ")})`);
  // The pin names the bytes; the snapshot commit is deterministic over them
  // (see setup-corpus.mjs), so its hash is comparable between machines too.
  console.log(`Corpus: ${describePin()}, snapshot ${describeCorpus(dataDir)}`);
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Git reset before each run");
  console.log("- .svelte only: the two Svelte-native formatters head-to-head");
  console.log("");

  // tsv runs twice: rsvelte-fmt is timed through its npm bin, a Node launcher
  // that execs its native binary, so tsv-npm — tsv through its own Node
  // dispatcher — is the like-for-like row against it, and bare tsv stays as the
  // baseline every ratio is taken against. A nondeterministic SIGABRT has been
  // observed in rsvelte-fmt 0.7.4 and 0.7.11; benchRows fails the scenario on it
  // rather than time a crashed partial run as a fast pass.
  await benchRows(
    [
      {
        name: "rsvelte-fmt",
        command: formatters.rsvelte(dataDir),
        check: formatters.check.rsvelte(dataDir),
      },
      {
        name: "tsv-npm",
        command: formatters["tsv-npm"](dataDir),
        check: formatters.check["tsv-npm"](dataDir),
      },
      { name: "tsv", command: formatters.tsv(dataDir), check: formatters.check.tsv(dataDir) },
    ],
    {
      projectRoot,
      warmup: WARMUP_RUNS,
      runs: BENCHMARK_RUNS,
      prepare: prepareCmd,
      baseline: "tsv",
    },
  );

  console.log("");
  console.log("Svelte benchmark complete!");
}

main().catch((error) => {
  console.error("Svelte benchmark failed:", error.message);
  process.exit(1);
});
