#!/usr/bin/env node

// What each way of installing tsv costs, rather than which formatter is fastest.
//
// tsv ships as more than one thing: the native binary from the
// `@fuzdev/tsv-<triple>` platform package (or a local build via `TSV_BIN`); that
// same binary reached through `@fuzdev/tsv`'s `tsv` bin, a Node dispatcher that
// spawns it — the way `npx tsv` and most npm installs run it; and
// `@fuzdev/tsv_wasm`, which runs the same CLI source over a WASM engine in Node
// and is the universal fallback on platforms with no prebuilt binary. Same
// formatter, same output — three very different deliveries.
//
// That question is deliberately kept out of the comparison scenarios. A row
// belongs there if it is the honest counterpart to how the *other* tools in that
// scenario are measured, and nothing benched against tsv is a WASM build, so a
// WASM row there would only muddle hyperfine's Summary ratios — mixing "which
// formatter is faster" with "which tsv distribution is faster" in one list.
//
// One file, not a tree, for a reason: the native binary parallelizes across
// files with a thread pool and the WASM CLI (since tsv 0.3) with a worker pool
// of its own, above a file-count threshold — two different pools with different
// costs, so a multi-file corpus would fold core count and pool warm-up into what
// reads as engine and delivery cost. With a single file the native binary clamps
// its pool to one and the WASM CLI stays below its threshold, so every row is
// honestly single-threaded: this is the fixed-cost comparison.

import { execSync } from "child_process";

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

  const dataFile = "./data/parser.ts";
  const dataFileBak = "./data/parser.ts.bak";
  // No config directory is used: every row is tsv, which takes no config file
  // or flags. The argument is still passed for the shared signature.
  const formatters = createFormatters("..", ".");

  printHeader("Benchmarking tsv Delivery Paths");

  checkGnuTime();

  const prepareCmd = `cp ${dataFileBak} ${dataFile}`;

  // Restore before preflight, not just between timed runs: the parse check and
  // file counts have to describe the corpus that gets benchmarked, not whatever
  // the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  console.log("");
  console.log("Target: TypeScript compiler parser.ts (~540KB), through each tsv distribution");
  console.log(`Corpus: ${describeCorpus(dataFile)}`);
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Copy original before each run");
  console.log("");

  // The three rows share one CLI source, so they share preflight's tsv matchers
  // and must report identical counts — which makes the scope cross-check here a
  // real assertion that all of them are formatting the same file, not three
  // spellings of one tool trivially agreeing. The npm row's preflight also
  // catches the dispatcher falling back to the JS CLI, which would otherwise be
  // timed under the wrong name.
  runPreflight([
    { name: "tsv-wasm", command: formatters.check["tsv-wasm"](dataFile) },
    { name: "tsv-npm", command: formatters.check["tsv-npm"](dataFile) },
    { name: "tsv", command: formatters.check.tsv(dataFile) },
  ]);

  // No --ignore-failure, as in every tsv scenario: preflight has ruled out the
  // corpus reasons either row would exit non-zero, so what's left is a real
  // crash and must fail the scenario rather than be timed as a fast partial run.
  //
  // Native tsv runs last, as it does in every other tsv scenario: hyperfine runs
  // the commands in the order given without interleaving, so on a laptop that
  // throttles, later rows meet a warmer machine. Keeping tsv last keeps that
  // bias pointed against it rather than for it.
  await runHyperfine([
    `--warmup=${WARMUP_RUNS}`,
    `--runs=${BENCHMARK_RUNS}`,
    "--prepare",
    prepareCmd,
    "--shell=bash",
    "-n=tsv-wasm",
    "-n=tsv-npm",
    "-n=tsv",
    formatters["tsv-wasm"](dataFile),
    formatters["tsv-npm"](dataFile),
    formatters.tsv(dataFile),
  ]);

  await runMemoryBenchmarks(
    [
      {
        name: "tsv-wasm",
        command: formatters["tsv-wasm"](dataFile),
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
  console.log("tsv delivery benchmark complete!");
}

main().catch((error) => {
  console.error("tsv delivery benchmark failed:", error.message);
  process.exit(1);
});
