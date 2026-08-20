#!/usr/bin/env node

// What each way of installing tsv costs, rather than which formatter is fastest.
//
// tsv ships as more than one thing: a native binary (built from source, or
// unpacked from the `@fuzdev/tsv-<triple>` platform package), and
// `@fuzdev/tsv_wasm`, which runs the same CLI source over a WASM engine in Node
// and is the universal fallback on platforms with no prebuilt binary. Same
// formatter, same output — very different delivery.
//
// That question is deliberately kept out of the comparison scenarios. A row
// belongs there if it is the honest counterpart to how the *other* tools in that
// scenario are measured, and nothing benched against tsv is a WASM build, so a
// WASM row there would only muddle hyperfine's Summary ratios — mixing "which
// formatter is faster" with "which tsv distribution is faster" in one list.
//
// One file, not a tree, for a reason: the WASM CLI is single-threaded (`--jobs`
// is accepted for parity and ignored) and the native binary is not, so a
// multi-file corpus would fold core count into what reads as engine cost. With a
// single file the native binary clamps its worker pool to one, and both rows are
// honestly single-threaded.

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
  // No config directory is used: both rows are tsv, which takes no config file
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

  // The two rows share one CLI source, so they share preflight's tsv matchers
  // and must report identical counts — which makes the scope cross-check here a
  // real assertion that both are formatting the same file, not two spellings of
  // one tool trivially agreeing.
  await runPreflight([
    { name: "tsv-wasm", command: formatters.check["tsv-wasm"](dataFile) },
    { name: "tsv", command: formatters.check.tsv(dataFile) },
  ]);

  // No --ignore-failure, as in every tsv scenario: preflight has ruled out the
  // corpus reasons either row would exit non-zero, so what's left is a real
  // crash and must fail the scenario rather than be timed as a fast partial run.
  //
  // When `@fuzdev/tsv` publishes, its `tsv` bin — a Node dispatcher that
  // spawnSyncs the platform package's native binary — belongs here as a third
  // row, measuring the Node cold start that the native row doesn't pay.
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
    "-n=tsv",
    formatters["tsv-wasm"](dataFile),
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
        name: "tsv",
        command: formatters.tsv(dataFile),
        prepare: prepareCmd,
      },
    ],
    BENCHMARK_RUNS,
  );

  console.log("");
  console.log("tsv delivery benchmark complete!");
}

main().catch((error) => {
  console.error("tsv delivery benchmark failed:", error.message);
  process.exit(1);
});
