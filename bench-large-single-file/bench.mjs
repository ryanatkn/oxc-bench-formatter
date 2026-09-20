#!/usr/bin/env node

import { execSync } from "child_process";

import {
  benchRunCounts,
  checkGnuTime,
  createFormatters,
  describeCorpus,
  printHeader,
  printRunCounts,
  printCorpus,
  printTarget,
  runHyperfine,
  runMemoryBenchmarks,
  runPreflight,
  settleArgs,
  setupCwd,
  warnUnshimmedTsvRows,
} from "../shared/utils.mjs";

const [WARMUP_RUNS, BENCHMARK_RUNS] = benchRunCounts(3, 20);

async function main() {
  setupCwd(import.meta.url);

  const dataFile = "./data/parser.ts";
  const dataFileBak = "./data/parser.ts.bak";
  const projectRoot = "..";
  const formatters = createFormatters(projectRoot, ".");

  printHeader("Benchmarking Large Single File");

  checkGnuTime();

  const prepareCmd = `cp ${dataFileBak} ${dataFile}`;

  // Restore before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  console.log("");
  printTarget("TypeScript compiler parser.ts (~540KB)");
  printCorpus(describeCorpus(dataFile));
  printRunCounts();
  console.log("- Copy original before each run");
  warnUnshimmedTsvRows(projectRoot, ["tsv-npm"]);
  console.log("");

  // Confirm every formatter accepts the corpus before timing it, and abort the
  // scenario if one doesn't. This is what lets the timed runs below drop
  // --ignore-failure: a tool that rejects the file would otherwise be timed on
  // work it never did.
  runPreflight([
    { name: "prettier", command: formatters.check.prettier(dataFile) },
    {
      name: "prettier+oxc-parser",
      command: formatters.check.prettier(dataFile, "prettierrc-oxc.json"),
    },
    { name: "biome", command: formatters.check.biome(dataFile) },
    { name: "oxfmt", command: formatters.check.oxfmt(dataFile) },
    // The dispatcher forwards the binary's output verbatim, so this row shares
    // tsv's matchers; its own signal catches a fallback to the JS CLI, which
    // would otherwise be timed under the wrong name.
    { name: "tsv-npm", command: formatters.check["tsv-npm"](dataFile) },
    { name: "tsv", command: formatters.check.tsv(dataFile) },
  ]);

  // No --ignore-failure: preflight above has already confirmed every formatter
  // parses the whole corpus, so the corpus reasons a formatter would exit
  // non-zero are ruled out before timing starts. What's left is a real crash —
  // which must fail the scenario rather than be timed as a fast partial run.
  //
  // tsv runs twice. The other four are timed the way npm installs them, through
  // a Node bin (biome's spawns its native binary exactly as tsv's dispatcher
  // does), so tsv-npm is tsv on that same footing and the row to read against
  // them; the bare-binary tsv row stays as the engine-side figure and the
  // baseline every ratio is taken against. Native tsv runs last: hyperfine runs
  // the commands in order without interleaving, so on a machine that throttles,
  // later rows meet a warmer one — keeping the bias pointed against tsv.
  await runHyperfine([
    `--warmup=${WARMUP_RUNS}`,
    `--runs=${BENCHMARK_RUNS}`,
    ...settleArgs(),
    "--prepare",
    prepareCmd,
    "--shell=bash",
    "-n=prettier",
    "-n=prettier+oxc-parser",
    "-n=biome",
    "-n=oxfmt",
    "-n=tsv-npm",
    "-n=tsv",
    formatters.prettier(dataFile),
    formatters.prettier(dataFile, "prettierrc-oxc.json"),
    formatters.biome(dataFile),
    formatters.oxfmt(dataFile),
    formatters["tsv-npm"](dataFile),
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
        name: "tsv-npm",
        command: formatters["tsv-npm"](dataFile),
        prepare: prepareCmd,
      },
      {
        name: "tsv",
        command: formatters.tsv(dataFile),
        prepare: prepareCmd,
      },
    ],
    BENCHMARK_RUNS,
    // Ratios against tsv, the scenario's subject, and a crash in a memory run
    // aborts the scenario — as it does in the timed pass, which runs without
    // --ignore-failure.
    { baseline: "tsv", failOnCrash: true },
  );

  console.log("");
  console.log("Large single file benchmark complete!");
}

main().catch((error) => {
  console.error("Large single file benchmark failed:", error.message);
  process.exit(1);
});
