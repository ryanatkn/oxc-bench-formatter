#!/usr/bin/env node

import { exec } from "child_process";
import { readFile, writeFile } from "fs/promises";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);

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

    // tsv is a native binary, not an npm package — read its version from the
    // sibling Cargo workspace ([workspace.package]), the source of truth every
    // tsv crate/package inherits. Falls back to "unknown" if ../tsv is absent.
    let tsv = "unknown";
    try {
      const cargo = await readFile("../tsv/Cargo.toml", "utf-8");
      const m = cargo.match(/\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/m);
      if (m) tsv = m[1];
    } catch {
      // ../tsv not present
    }

    return {
      prettier: prettier.stdout.trim(),
      biome: biome.stdout.trim().replace("Version: ", ""),
      oxfmt: oxfmt.stdout.trim().replace("Version: ", ""),
      rsvelte: rsvelte.stdout.trim().replace("rsvelte_fmt ", ""),
      tsv,
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
    /## Versions\n\n- \*\*Prettier\*\*: .*\n- \*\*Biome\*\*: .*\n- \*\*Oxfmt\*\*: .*\n- \*\*rsvelte-fmt\*\*: .*\n- \*\*tsv\*\*: .*(\n\n_Measured on: .*_)?/;
  const newVersionsContent = `## Versions\n\n- **Prettier**: ${versions.prettier}\n- **Biome**: ${versions.biome}\n- **Oxfmt**: ${versions.oxfmt}\n- **rsvelte-fmt**: ${versions.rsvelte}\n- **tsv**: ${versions.tsv}\n\n_Measured on: ${describeMachine()} — the ratios below depend on the core count._`;

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
