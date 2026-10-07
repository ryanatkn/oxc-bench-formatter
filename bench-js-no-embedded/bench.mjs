#!/usr/bin/env node

import { execSync } from "child_process";

import {
  benchRunCounts,
  checkGnuTime,
  createFormatters,
  describeCorpus,
  printHeader,
  printCorpus,
  printTarget,
  resetCorpusCommand,
  runHyperfine,
  runMemoryBenchmarks,
  runPreflight,
  setupCwd,
} from "../shared/utils.mjs";

const [WARMUP_RUNS, BENCHMARK_RUNS] = benchRunCounts(3, 10);

async function main() {
  setupCwd(import.meta.url);

  const dataDir = "./data";
  const formatters = createFormatters("..", ".");

  printHeader("Benchmarking JS/TS (no embedded)");

  checkGnuTime();

  console.log("");
  printTarget("Outline repository (js/ts/tsx only)");
  printCorpus(describeCorpus(dataDir));
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Git reset before each run");
  console.log("");

  const prepareCmd = resetCorpusCommand(dataDir);

  // Reset before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  // Confirm every formatter accepts the corpus before timing it, and abort the
  // scenario if one doesn't. This is what lets the timed runs below drop
  // upstream's --ignore-failure: a tool that rejects files would otherwise be
  // timed on work it never did.
  runPreflight([
    { name: "prettier", command: formatters.check.prettier(dataDir) },
    {
      name: "prettier+oxc-parser",
      command: formatters.check.prettier(dataDir, "prettierrc-oxc.json"),
    },
    { name: "biome", command: formatters.check.biome(dataDir) },
    { name: "oxfmt", command: formatters.check.oxfmt(dataDir) },
  ]);

  await runHyperfine([
    `--warmup=${WARMUP_RUNS}`,
    `--runs=${BENCHMARK_RUNS}`,
    "--prepare",
    prepareCmd,
    "--shell=bash",
    "-n=prettier",
    "-n=prettier+oxc-parser",
    "-n=biome",
    "-n=oxfmt",
    formatters.prettier(dataDir),
    formatters.prettier(dataDir, "prettierrc-oxc.json"),
    formatters.biome(dataDir),
    formatters.oxfmt(dataDir),
  ]);

  await runMemoryBenchmarks(
    [
      {
        name: "prettier",
        command: formatters.prettier(dataDir),
        prepare: prepareCmd,
      },
      {
        name: "prettier+oxc-parser",
        command: formatters.prettier(dataDir, "prettierrc-oxc.json"),
        prepare: prepareCmd,
      },
      {
        name: "biome",
        command: formatters.biome(dataDir),
        prepare: prepareCmd,
      },
      {
        name: "oxfmt",
        command: formatters.oxfmt(dataDir),
        prepare: prepareCmd,
      },
    ],
    BENCHMARK_RUNS,
    // Ratios against oxfmt, upstream's subject, so the column doesn't re-anchor
    // on whichever tool used least this run. A crash in a memory run aborts the
    // scenario, as it does in the timed pass.
    { baseline: "oxfmt", failOnCrash: true },
  );

  console.log("");
  console.log("JS/TS (no embedded) benchmark complete!");
}

main().catch((error) => {
  console.error("JS/TS (no embedded) benchmark failed:", error.message);
  process.exit(1);
});
