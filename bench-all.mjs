#!/usr/bin/env node

import { spawn } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";

import { assertBenchReady, clearResults } from "./shared/utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Benchmark scenarios to run
const scenarios = [
  "bench-large-single-file",
  "bench-js-no-embedded",
  "bench-mixed-embedded",
  "bench-full-features",
  "bench-ts-only",
  "bench-svelte",
  "bench-tsv-delivery",
];

async function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    const scriptPath = `${__dirname}/${scenario}/bench.mjs`;
    const proc = spawn("node", [scriptPath], { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${scenario} failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

// The scenarios' preflight guard is only as good as its diagnostic matchers, and
// a matcher that stopped matching reports every corpus as clean. Verify them
// against fixtures first: unlike a scenario failure, this one is fatal, since it
// would let every scenario below publish numbers behind a guard that isn't
// guarding. Runs in its own process so its chdir can't leak into the scenarios.
async function runPreflightSelfTest() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [`${__dirname}/preflight-selftest.mjs`], { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`preflight self-test failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  // Setup is a separate, explicit step rather than something this script runs
  // for you: `./init.sh` is where every network access in the suite lives, and
  // keeping it out of the run is what lets the machine be offline for the
  // benchmark itself. Missing corpora or dependencies stop here, named.
  assertBenchReady(__dirname);

  console.log("=========================================");
  console.log("JavaScript/TypeScript Formatter Benchmark");
  console.log("=========================================");
  console.log("");
  console.log(
    "Formatters: Prettier, Biome, Oxfmt, tsv + tsv-npm (JSX-free and Svelte scenarios), rsvelte-fmt (Svelte scenario), tsv-wasm (delivery scenario)",
  );
  console.log("");

  await runPreflightSelfTest();
  console.log("");

  // Each scenario leaves a record in `results/`; start from none, so whatever
  // composes them afterwards reads one run and not the leftovers of another.
  clearResults();

  for (const scenario of scenarios) {
    try {
      await runScenario(scenario);
    } catch (e) {
      console.error(`Error running ${scenario}: ${e.message}`);
    }
    console.log("");
  }

  console.log("=========================================");
  console.log("All benchmarks complete!");
  console.log("=========================================");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
