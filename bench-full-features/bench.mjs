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

const [WARMUP_RUNS, BENCHMARK_RUNS] = benchRunCounts(1, 3);

// Files a formatter here rejects, removed in the prepare step along with the
// repo's own `.prettierrc`, so both formatters are timed on the same set;
// preflight aborts the scenario on any other. All three are declaration files.
// The first initializes a constant inside an ambient namespace, which both
// formatters report as a syntax error; the other two are refused by prettier's
// sort-imports plugin and formatted by oxfmt.
const REJECTED_FILES = [
  "core/index.d.ts",
  "docs-site/next-env.d.ts",
  "extensions/vscode/src/otherExtensions/git.d.ts",
];

async function main() {
  setupCwd(import.meta.url);

  const dataDir = "./data";
  const formatters = createFormatters("..", ".");

  printHeader("Benchmarking Full features");

  checkGnuTime();

  console.log("");
  printTarget("Continue repository (full features)");
  printCorpus(describeCorpus(dataDir));
  console.log(`- ${WARMUP_RUNS} warmup runs, ${BENCHMARK_RUNS} benchmark runs`);
  console.log("- Git reset before each run");
  console.log(`- ${REJECTED_FILES.length} files a formatter rejects removed before each run`);
  console.log("");

  const prepareCmd = `${resetCorpusCommand(dataDir)} && sed -i.bak '/require("tailwindcss\\/defaultTheme")/d' ${dataDir}/gui/tailwind.config.cjs && rm -f ${dataDir}/gui/tailwind.config.cjs.bak ${dataDir}/.prettierrc ${REJECTED_FILES.map((file) => `${dataDir}/${file}`).join(" ")}`;

  // Reset before the preflight below, not just between timed runs: its parse
  // check and file counts have to describe the corpus that gets benchmarked, not
  // whatever the previous run left formatted.
  execSync(prepareCmd, { stdio: "ignore" });

  // Confirm every formatter accepts the corpus before timing it, and abort the
  // scenario if one doesn't. This is what lets the timed runs below drop
  // upstream's --ignore-failure: a tool that rejects files would otherwise be
  // timed on work it never did.
  runPreflight([
    { name: "prettier+oxc-parser", command: formatters.check.prettier(dataDir) },
    { name: "oxfmt", command: formatters.check.oxfmt(dataDir) },
  ]);

  await runHyperfine([
    `--warmup=${WARMUP_RUNS}`,
    `--runs=${BENCHMARK_RUNS}`,
    "--prepare",
    prepareCmd,
    "--shell=bash",
    "-n=prettier+oxc-parser",
    "-n=oxfmt",
    formatters.prettier(dataDir),
    formatters.oxfmt(dataDir),
  ]);

  await runMemoryBenchmarks(
    [
      {
        name: "prettier+oxc-parser",
        command: formatters.prettier(dataDir),
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
  console.log("Full features benchmark complete!");
}

main().catch((error) => {
  console.error("Full features benchmark failed:", error.message);
  process.exit(1);
});
