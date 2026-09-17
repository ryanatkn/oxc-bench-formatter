#!/usr/bin/env node

import { exec, execFile } from "child_process";
import { constants } from "fs";
import { access, readFile, stat, writeFile } from "fs/promises";
import os from "os";
import { promisify } from "util";

import { assertBenchReady, resolveTsv } from "./shared/utils.mjs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * The tsv binary this run will bench and where it came from — the same
 * resolution `shared/utils.mjs` does, so the version reported and the binary
 * measured are the same file rather than two things that usually agree.
 */
const { bin: tsvBin, source: tsvSource } = resolveTsv(".");

/**
 * The machine the numbers came from. Recorded because the ratios move with it:
 * biome, oxfmt, and tsv all scale across cores while prettier is effectively
 * serial, so a 4-core runner and a 12-thread laptop produce genuinely different
 * comparisons, not noisy versions of one. Without this line the results are not
 * reproducible or interpretable.
 */
function describeMachine() {
  const cpus = os.cpus();
  const model = cpus[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown CPU";
  return `${model} · ${cpus.length} threads · ${os.platform()} ${os.arch()}`;
}

/**
 * Refuse to publish without a usable tsv binary.
 *
 * Without one the four tsv scenarios abort, and a scenario abort is non-fatal to
 * `bench-all.mjs` — so the README would quietly lose those scenarios whole, not
 * just their tsv rows. The binary normally comes from `@fuzdev/tsv`'s platform
 * package, installed by `pnpm install` and pinned by the lockfile, so there is
 * nothing to build here any more; `TSV_BIN` still benches a local build as-is.
 */
async function prepareTsv() {
  console.log(
    tsvSource === "TSV_BIN"
      ? `Using TSV_BIN as-is: ${tsvBin}`
      : `Using tsv from ${tsvSource ?? "(unresolved)"}: ${tsvBin}`,
  );
  try {
    await access(tsvBin, constants.X_OK);
  } catch {
    console.error(`No executable tsv binary at ${tsvBin}.`);
    console.error("Run pnpm install, or point TSV_BIN at a local build.");
    process.exit(1);
  }
}

async function runBenchmark() {
  console.log("Running benchmark...");
  try {
    const { stdout } = await execAsync("vp run bench");
    return stdout;
  } catch (error) {
    console.error("Error running benchmark:", error);
    process.exit(1);
  }
}

function extractBenchmarkResults(output) {
  // Extract everything from "=========================================" onwards
  // This captures both the parser.ts and outline repository benchmarks
  const benchmarkStartMatch = output.match(
    /=========================================\nBenchmarking .*?\n=========================================\n([\s\S]*)/,
  );

  if (!benchmarkStartMatch) {
    throw new Error("Could not find benchmark results in output");
  }

  const benchmarkSection = benchmarkStartMatch[0].trim();

  return benchmarkSection;
}

async function getVersions() {
  console.log("Fetching versions...");
  try {
    const [prettier, biome, oxfmt, rsvelte] = await Promise.all([
      execAsync("vp exec prettier --version"),
      execAsync("vp exec biome --version"),
      execAsync("vp exec oxfmt --version"),
      execAsync("vp exec rsvelte-fmt --version"),
    ]);

    // tsv is a native binary, not an npm bin `vp exec` can reach — ask the
    // binary itself. Sourcing this from the measured artifact is what keeps the
    // label honest: with TSV_BIN it names the build that actually ran, and with
    // the platform package it is cross-checked against that package's version
    // below, so a binary that isn't the one the lockfile pins can't publish
    // under its number.
    let tsv = "unknown";
    try {
      const { stdout } = await execFileAsync(tsvBin, ["--version"]);
      tsv = stdout.trim().replace(/^tsv /, "");
    } catch {
      // no usable binary — the tsv rows are missing from the results anyway
    }

    if (tsvSource === "TSV_BIN") {
      // A local build's version is a workspace constant that doesn't move
      // between builds, so it can't tell a binary built this morning from one
      // built months ago. Its mtime can. Local date, not toISOString(): a build
      // at 20:57 local reads as the next day in UTC, which wouldn't match
      // `git log --date=short` on the corpus line or the wall calendar of
      // whoever ran the benchmark.
      try {
        const built = (await stat(tsvBin)).mtime.toLocaleDateString("en-CA");
        tsv = `${tsv} (TSV_BIN, binary built ${built})`;
      } catch {
        // no binary to date
      }
    } else if (tsvSource) {
      const [name, version] = tsvSource
        .split("@")
        .filter(Boolean)
        .map((s) => s.trim());
      if (tsv !== version && tsv !== "unknown") {
        console.error(
          `tsv --version says ${tsv} but the installed platform package is ${tsvSource}; refusing to publish a mismatched version`,
        );
        process.exit(1);
      }
      tsv = `${tsv} (@${name})`;
    }

    // @fuzdev/tsv-wasm is an npm package, but not one `vp exec` can reach: its
    // bin is named `tsv`, the same name the native @fuzdev/tsv claims, so the
    // harness addresses its cli.js by path and there is no bin to ask. Its CLI
    // has no --version flag either (the native one does), so the installed
    // package's own manifest is the source — still the artifact that ran.
    let tsvWasm = "unknown";
    try {
      const pkg = JSON.parse(await readFile("node_modules/@fuzdev/tsv-wasm/package.json", "utf-8"));
      tsvWasm = pkg.version;
    } catch {
      // not installed — the tsv-wasm row is missing from the results anyway
    }

    return {
      prettier: prettier.stdout.trim(),
      biome: biome.stdout.trim().replace("Version: ", ""),
      oxfmt: oxfmt.stdout.trim().replace("Version: ", ""),
      rsvelte: rsvelte.stdout.trim().replace("rsvelte_fmt ", ""),
      tsv,
      tsvWasm,
    };
  } catch (error) {
    console.error("Error fetching versions:", error);
    process.exit(1);
  }
}

async function updateReadme(benchmarkResults, versions) {
  console.log("Updating README...");

  const readmePath = "README.md";
  let readmeContent = await readFile(readmePath, "utf-8");

  // Find the benchmark results section between markers
  const startMarker = "<!-- BENCHMARK_RESULTS_START -->";
  const endMarker = "<!-- BENCHMARK_RESULTS_END -->";

  const startIndex = readmeContent.indexOf(startMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Could not find benchmark results markers in README.md");
  }

  // Create the new benchmark content
  const newBenchmarkContent = `\`\`\`
${benchmarkResults}
\`\`\``;

  // Replace the content between markers
  const beforeMarker = readmeContent.substring(0, startIndex + startMarker.length);
  const afterMarker = readmeContent.substring(endIndex);

  readmeContent = beforeMarker + "\n" + newBenchmarkContent + "\n" + afterMarker;

  // Update versions section. The trailing machine line is optional in the match
  // so this still works against a README written before it existed.
  const versionsRegex =
    /## Versions\n\n- \*\*Prettier\*\*: .*\n- \*\*Biome\*\*: .*\n- \*\*Oxfmt\*\*: .*\n- \*\*rsvelte-fmt\*\*: .*\n- \*\*tsv\*\*: .*(\n- \*\*tsv-wasm\*\*: .*)?(\n\n_Measured on: .*_)?/;
  const newVersionsContent = `## Versions\n\n- **Prettier**: ${versions.prettier}\n- **Biome**: ${versions.biome}\n- **Oxfmt**: ${versions.oxfmt}\n- **rsvelte-fmt**: ${versions.rsvelte}\n- **tsv**: ${versions.tsv}\n- **tsv-wasm**: ${versions.tsvWasm}\n\n_Measured on: ${describeMachine()} — the ratios below depend on the core count._`;

  if (!versionsRegex.test(readmeContent)) {
    // Fail rather than warn: writing fresh numbers under a stale version list is
    // the one outcome worse than not updating at all, and a warning in a
    // multi-minute benchmark log is easy to scroll past.
    throw new Error(
      "Could not find the versions section in README.md — fresh results would be published under a stale version list",
    );
  }
  readmeContent = readmeContent.replace(versionsRegex, newVersionsContent);

  await writeFile(readmePath, readmeContent);
  console.log("README updated successfully");
}

async function main() {
  try {
    // Both readiness checks up front, before the multi-minute run: a missing
    // corpus and a missing tsv binary each cost the README whole scenarios, and
    // the corpus one is also the only thing here that would want the network.
    // Setup is `./init.sh`, run separately and while online — everything from
    // here on reads local files, so the machine can be disconnected first.
    assertBenchReady(".");
    await prepareTsv();
    const benchmarkOutput = await runBenchmark();
    const results = extractBenchmarkResults(benchmarkOutput);
    const versions = await getVersions();
    await updateReadme(results, versions);

    console.log("README has been updated with the latest benchmark results");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

void main();
