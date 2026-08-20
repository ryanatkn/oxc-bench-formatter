#!/usr/bin/env node

import { execSync } from "child_process";

import {
  checkGnuTime,
  createFormatters,
  describeCorpus,
  printHeader,
  runHyperfine,
  runMemoryBenchmarks,
  runPreflight,
  setupCwd,
} from "../shared/utils.mjs";

const WARMUP_RUNS = 2;
const BENCHMARK_RUNS = 5;

async function main() {
  setupCwd(import.meta.url);

  const dataFile = "./data/parser.ts";
  const dataFileBak = "./data/parser.ts.bak";
  const formatters = createFormatters("..", ".");

  printHeader("Benchmarking Large Single File");

  checkGnuTime();

  const prepareCmd = `cp ${dataFileBak} ${dataFile}`;

  // Restore before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  console.log("");
  console.log("Target: TypeScript compiler parser.ts (~540KB)");
  console.log(`Corpus: ${describeCorpus(dataFile)}`);
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Copy original before each run");
  console.log("");

  // Confirm every formatter accepts the corpus before timing it, and abort the
  // scenario if one doesn't. This is what lets the timed runs below drop
  // --ignore-failure: a tool that rejects the file would otherwise be timed on
  // work it never did.
  await runPreflight([
    { name: "prettier", command: formatters.check.prettier(dataFile) },
    {
      name: "prettier+oxc-parser",
      command: formatters.check.prettier(dataFile, "prettierrc-oxc.json"),
    },
    { name: "biome", command: formatters.check.biome(dataFile) },
    { name: "oxfmt", command: formatters.check.oxfmt(dataFile) },
    { name: "tsv", command: formatters.check.tsv(dataFile) },
  ]);

  // No --ignore-failure: preflight above has already confirmed every formatter
  // parses the whole corpus, so the corpus reasons a formatter would exit
  // non-zero are ruled out before timing starts. What's left is a real crash —
  // which must fail the scenario rather than be timed as a fast partial run.
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
    "-n=tsv",
    formatters.prettier(dataFile),
    formatters.prettier(dataFile, "prettierrc-oxc.json"),
    formatters.biome(dataFile),
    formatters.oxfmt(dataFile),
    formatters.tsv(dataFile),
  ]);

  await runMemoryBenchmarks(
    [
      {
        name: "prettier",
        command: formatters.prettier(dataFile),
        prepare: prepareCmd,
      },
      {
        name: "prettier+oxc-parser",
        command: formatters.prettier(dataFile, "prettierrc-oxc.json"),
        prepare: prepareCmd,
      },
      {
        name: "biome",
        command: formatters.biome(dataFile),
        prepare: prepareCmd,
      },
      {
        name: "oxfmt",
        command: formatters.oxfmt(dataFile),
        prepare: prepareCmd,
      },
      {
        name: "tsv",
        command: formatters.tsv(dataFile),
        prepare: prepareCmd,
      },
    ],
    BENCHMARK_RUNS,
  );

  console.log("");
  console.log("Large single file benchmark complete!");
}

main().catch((error) => {
  console.error("Large single file benchmark failed:", error.message);
  process.exit(1);
});
