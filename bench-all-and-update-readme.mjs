#!/usr/bin/env node

import { exec, execFile, spawn } from "child_process";
import { constants, existsSync } from "fs";
import { access, readFile, stat, writeFile } from "fs/promises";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * The tsv binary this run will bench — the same resolution `shared/utils.mjs`
 * does, repeated here so the version reported and the binary measured are the
 * same file rather than two things that usually agree.
 */
const tsvBin = process.env.TSV_BIN ?? "../tsv/target/release/tsv";

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
 * Bring the tsv binary up to date before benching it, and refuse to publish
 * without one.
 *
 * Nothing else does this: `bench-all.mjs` runs `init.sh` only when a corpus is
 * missing, and `init.sh` builds tsv only when the binary is *absent* — it never
 * refreshes a stale one, deliberately, so a pinned copy isn't overwritten. That
 * is fine while iterating; this is the publish path, where the numbers land in
 * the README under a version string and the two have to describe the same
 * build. An explicit `TSV_BIN` is still left alone — pinning a fixed binary is
 * the whole point of that path.
 */
async function prepareTsv() {
  if (process.env.TSV_BIN) {
    console.log(`Using TSV_BIN as-is (not rebuilt): ${tsvBin}`);
  } else if (existsSync("../tsv/Cargo.toml")) {
    console.log("Building tsv release binary...");
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(
          "cargo",
          ["build", "--release", "-p", "tsv_cli", "--manifest-path", "../tsv/Cargo.toml"],
          { stdio: "inherit" },
        );
        proc.on("error", reject);
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`cargo build exited with code ${code}`)),
        );
      });
    } catch (error) {
      console.error(`Error building tsv: ${error.message}`);
      console.error("Fix ../tsv, or set TSV_BIN to a prebuilt binary to bench that instead.");
      process.exit(1);
    }
  }

  // Without a usable binary the three tsv scenarios abort, and a scenario abort
  // is non-fatal to `bench-all.mjs` — so the README would quietly lose those
  // scenarios whole, not just their tsv rows. Refuse to publish that.
  try {
    await access(tsvBin, constants.X_OK);
  } catch {
    console.error(`No executable tsv binary at ${tsvBin}.`);
    console.error("Check out ../tsv, or point TSV_BIN at a prebuilt binary.");
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

    // tsv is a native binary, not an npm package, so `vp exec` can't reach it —
    // ask the binary itself. Sourcing this from the measured artifact rather
    // than from `../tsv/Cargo.toml` is what keeps the label honest: the
    // workspace version moves at a release and the binary only when it's
    // rebuilt, so the two disagree exactly when a stale build is being
    // published. It also means the copy-in `TSV_BIN` path names a real version
    // instead of degrading to "unknown".
    let tsv = "unknown";
    try {
      const { stdout } = await execFileAsync(tsvBin, ["--version"]);
      tsv = stdout.trim().replace(/^tsv /, "");
    } catch {
      // no usable binary — the tsv rows are missing from the results anyway
    }

    // That version is a workspace constant: it doesn't move between builds, so
    // it still can't tell a binary built this morning from one built months ago.
    // Its mtime can.
    try {
      // Local date, not toISOString(): a binary built at 20:57 local reads as the
      // next day in UTC, which wouldn't match `git log --date=short` on the
      // corpus line or the wall calendar of whoever ran the benchmark.
      const built = (await stat(tsvBin)).mtime.toLocaleDateString("en-CA");
      tsv = `${tsv} (binary built ${built})`;
    } catch {
      // no binary to date
    }

    // @fuzdev/tsv_wasm is an npm package, but not one `vp exec` can reach: its
    // bin is named `tsv`, the same name the native @fuzdev/tsv claims, so the
    // harness addresses its cli.js by path and there is no bin to ask. Its CLI
    // has no --version flag either (the native one does), so the installed
    // package's own manifest is the source — still the artifact that ran.
    let tsvWasm = "unknown";
    try {
      const pkg = JSON.parse(await readFile("node_modules/@fuzdev/tsv_wasm/package.json", "utf-8"));
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
    /## Versions\n\n- \*\*Prettier\*\*: .*\n- \*\*Biome\*\*: .*\n- \*\*Oxfmt\*\*: .*\n- \*\*rsvelte-fmt\*\*: .*\n- \*\*tsv\*\*: .*(\n- \*\*tsv_wasm\*\*: .*)?(\n\n_Measured on: .*_)?/;
  const newVersionsContent = `## Versions\n\n- **Prettier**: ${versions.prettier}\n- **Biome**: ${versions.biome}\n- **Oxfmt**: ${versions.oxfmt}\n- **rsvelte-fmt**: ${versions.rsvelte}\n- **tsv**: ${versions.tsv}\n- **tsv_wasm**: ${versions.tsvWasm}\n\n_Measured on: ${describeMachine()} — the ratios below depend on the core count._`;

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

main();
