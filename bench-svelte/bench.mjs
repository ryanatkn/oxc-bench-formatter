#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync } from "fs";

import {
  benchRunCounts,
  checkGnuTime,
  createFormatters,
  describeCorpus,
  printHeader,
  runHyperfine,
  runMemoryBenchmarks,
  runPreflight,
  setupCwd,
} from "../shared/utils.mjs";

const [WARMUP_RUNS, BENCHMARK_RUNS] = benchRunCounts(2, 5);

async function main() {
  setupCwd(import.meta.url);

  const dataDir = "./data";
  const formatters = createFormatters("..", ".");

  printHeader("Benchmarking Svelte (tsv vs rsvelte-fmt)");

  checkGnuTime();

  console.log("");
  // This is the one corpus that can't be fetched — it's built from sibling
  // checkouts by setup-corpus.mjs — so name the fix instead of failing inside
  // `git reset` with "not a git repository".
  if (!existsSync(`${dataDir}/.git`)) {
    console.error(
      "bench-svelte corpus missing. Build it with `node ./bench-svelte/setup-corpus.mjs` (needs ../kit and ../svelte.dev checked out).",
    );
    process.exit(1);
  }

  const prepareCmd = `git -C ${dataDir} reset --hard`;

  // Reset before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  console.log(
    "Target: third-party .svelte corpus (kit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake)",
  );
  console.log(`Corpus: ${describeCorpus(dataDir)}`);
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Git reset before each run");
  console.log("- .svelte only: the two Svelte-native formatters head-to-head");
  console.log("");

  // Confirm both formatters accept the whole corpus before timing it, and abort
  // the scenario if one doesn't.
  await runPreflight([
    { name: "tsv", command: formatters.check.tsv(dataDir) },
    { name: "rsvelte-fmt", command: formatters.check.rsvelte(dataDir) },
  ]);

  // No --ignore-failure, unlike the other scenarios: both formatters exit 0 on
  // a successful write run, so the only non-zero exits here are real errors or
  // crashes (a nondeterministic SIGABRT has been observed in rsvelte-fmt
  // 0.7.4), and a crashed partial run must fail the benchmark loudly rather
  // than be timed as a fast pass.
  await runHyperfine([
    `--warmup=${WARMUP_RUNS}`,
    `--runs=${BENCHMARK_RUNS}`,
    "--prepare",
    prepareCmd,
    "--shell=bash",
    "-n=tsv",
    "-n=rsvelte-fmt",
    formatters.tsv(dataDir),
    formatters.rsvelte(dataDir),
  ]);

  await runMemoryBenchmarks(
    [
      {
        name: "tsv",
        command: formatters.tsv(dataDir),
        prepare: prepareCmd,
      },
      {
        name: "rsvelte-fmt",
        command: formatters.rsvelte(dataDir),
        prepare: prepareCmd,
      },
    ],
    BENCHMARK_RUNS,
  );

  console.log("");
  console.log("Svelte benchmark complete!");
}

main().catch((error) => {
  console.error("Svelte benchmark failed:", error.message);
  process.exit(1);
});
