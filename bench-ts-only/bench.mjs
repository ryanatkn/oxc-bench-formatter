#!/usr/bin/env node

import { execSync } from "child_process";

import {
  assertScopeConfigsAgree,
  benchRows,
  benchRunCounts,
  checkGnuTime,
  createFormatters,
  describeCorpus,
  printHeader,
  setupCwd,
} from "../shared/utils.mjs";

const [WARMUP_RUNS, BENCHMARK_RUNS] = benchRunCounts(2, 5);

async function main() {
  setupCwd(import.meta.url);

  const dataDir = "./data";
  const projectRoot = "..";
  const formatters = createFormatters(projectRoot, ".");

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

  // tsv runs twice. The other four are timed the way npm installs them, through
  // a Node bin (biome's spawns its native binary exactly as tsv's dispatcher
  // does), so tsv-npm is tsv on that same footing and the row to read against
  // them; the bare-binary tsv row stays as the engine-side figure and the
  // baseline every ratio is taken against.
  const oxc = "prettierrc-oxc.json";
  await benchRows(
    [
      {
        name: "prettier",
        command: formatters.prettier(dataDir),
        check: formatters.check.prettier(dataDir),
      },
      {
        name: "prettier+oxc-parser",
        command: formatters.prettier(dataDir, oxc),
        check: formatters.check.prettier(dataDir, oxc),
      },
      {
        name: "biome",
        command: formatters.biome(dataDir),
        check: formatters.check.biome(dataDir),
      },
      {
        name: "oxfmt",
        command: formatters.oxfmt(dataDir),
        check: formatters.check.oxfmt(dataDir),
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
  console.log("TypeScript-only (non-JSX subset) benchmark complete!");
}

main().catch((error) => {
  console.error("TypeScript-only benchmark failed:", error.message);
  process.exit(1);
});
