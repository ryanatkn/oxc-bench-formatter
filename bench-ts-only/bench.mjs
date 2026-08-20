#!/usr/bin/env node

import { execSync } from "child_process";

import {
  assertScopeConfigsAgree,
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

  const dataDir = "./data";
  const formatters = createFormatters("..", ".");

  printHeader("Benchmarking TypeScript-only (non-JSX subset)");

  checkGnuTime();

  const prepareCmd = `git -C ${dataDir} reset --hard`;

  // Reset before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  console.log("");

  // The three scoping files are independent; if they've drifted apart, the
  // formatters below are not benching the same set. Cheap enough to check every
  // run, and it needs no corpus.
  assertScopeConfigsAgree(".");

  console.log("Target: Outline repository (non-JSX JS/TS subset)");
  console.log(`Corpus: ${describeCorpus(dataDir)}`);
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Git reset before each run");
  console.log("- .ts/.js/.mjs only: the common file set every formatter (incl. tsv) supports");
  console.log("");

  // Confirm every formatter accepts the whole corpus before timing it, and abort
  // the scenario if one doesn't. This is what lets the timed runs below drop
  // --ignore-failure: a tool that rejects files would otherwise be timed on the
  // ones it skipped and look faster for it.
  await runPreflight([
    { name: "prettier", command: formatters.check.prettier(dataDir) },
    {
      name: "prettier+oxc-parser",
      command: formatters.check.prettier(dataDir, "prettierrc-oxc.json"),
    },
    { name: "biome", command: formatters.check.biome(dataDir) },
    { name: "oxfmt", command: formatters.check.oxfmt(dataDir) },
    { name: "tsv", command: formatters.check.tsv(dataDir) },
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
    formatters.prettier(dataDir),
    formatters.prettier(dataDir, "prettierrc-oxc.json"),
    formatters.biome(dataDir),
    formatters.oxfmt(dataDir),
    formatters.tsv(dataDir),
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
      {
        name: "tsv",
        command: formatters.tsv(dataDir),
        prepare: prepareCmd,
      },
    ],
    BENCHMARK_RUNS,
  );

  console.log("");
  console.log("TypeScript-only (non-JSX subset) benchmark complete!");
}

main().catch((error) => {
  console.error("TypeScript-only benchmark failed:", error.message);
  process.exit(1);
});
