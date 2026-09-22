#!/usr/bin/env node

import { exec, execFile } from "child_process";
import { constants } from "fs";
import { access, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import os from "os";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { assertBenchReady, RESULTS_DIR, resolveTsv, round } from "./shared/utils.mjs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Every path below is relative to the repo root — README.md, node_modules, the
// `vp run bench` it shells out to — so run from there whatever directory the
// script was started in, as `bench-all.mjs` and the scenarios already do.
const projectRoot = dirname(fileURLToPath(import.meta.url));
process.chdir(projectRoot);

/**
 * Child environment with this project's `node_modules/.bin` on PATH.
 *
 * Every `vp` call below — the benchmark run itself and the four npm-bin version
 * reads — resolves `vp` from there. A package-manager script gets that for free,
 * but running this file as `node bench-all-and-update-readme.mjs` does not, and
 * that invocation is the recommended one when the machine is offline (see the
 * pnpm caveat in CLAUDE.md). Setting it here keeps the launcher from deciding
 * whether the script works.
 */
const binEnv = {
  ...process.env,
  PATH: `${join(projectRoot, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
};

/**
 * The tsv binary this run will bench and where it came from — the same
 * resolution `shared/utils.mjs` does, so the version reported and the binary
 * measured are the same file rather than two things that usually agree.
 */
const { bin: tsvBin, source: tsvSource } = resolveTsv(".");

/**
 * How long a bare `node -e ""` takes on this machine, in milliseconds — the floor
 * every npm-bin row pays before its formatter runs (Prettier's, Biome's, Oxfmt's,
 * rsvelte-fmt's, and tsv's dispatcher row all start Node). Measured once per run
 * under hyperfine with the same PATH the scenarios resolve `node` from, so it is
 * a machine property beside `machine` and `versions` rather than a row: a row
 * would be folded into "every other tool" by consumers ranging over the tables.
 */
async function measureNodeStartup() {
  const exportPath = join(os.tmpdir(), `bench-formatter-node-startup-${process.pid}.json`);
  const runs = 20;
  try {
    await execFileAsync(
      "hyperfine",
      ["--warmup=3", `--runs=${runs}`, "--shell=bash", `--export-json=${exportPath}`, 'node -e ""'],
      { env: binEnv },
    );
    const [result] = JSON.parse(await readFile(exportPath, "utf-8")).results;
    // rounded like every other duration in the record, so the file carries one
    // precision rather than one value at hyperfine's full float width
    return {
      mean_ms: round(result.mean * 1000, 3),
      stddev_ms: round((result.stddev ?? 0) * 1000, 3),
      runs,
    };
  } finally {
    await rm(exportPath, { force: true });
  }
}

/**
 * The machine the numbers came from. Recorded because the ratios move with it:
 * biome, oxfmt, and tsv all scale across cores while prettier is effectively
 * serial, so a 4-core runner and a 12-thread laptop produce genuinely different
 * comparisons, not noisy versions of one. Without it the results are not
 * reproducible or interpretable.
 *
 * Fields, not a display line, so a consumer can compare them: `arch` is
 * `os.machine()` (`uname -m`: `x86_64`, `aarch64`) rather than Node's
 * `os.arch()` naming, matching the reports tsv's own benches write.
 */
function describeMachine() {
  const cpus = os.cpus();
  return {
    cpu_model: cpus[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown CPU",
    threads: cpus.length,
    os: os.platform(),
    arch: os.machine(),
  };
}

/** The machine as the README's one line shows it. */
function formatMachine({ cpu_model, threads, os: platform, arch }) {
  return `${cpu_model} · ${threads} threads · ${platform} ${arch}`;
}

/**
 * The harness revision that ran, read before the run: its commit, and whether
 * the tree had changes beyond it — a dirty run's numbers came from code no
 * commit holds. The run itself rewrites README.md and results.json, so this is
 * only meaningful taken first.
 */
async function describeHarness() {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--short", "HEAD"]),
    execFileAsync("git", ["status", "--porcelain"]),
  ]);
  return { git_commit: commit.trim(), git_dirty: status.trim() !== "" };
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
    const { stdout } = await execAsync("vp run bench", { env: binEnv });
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

  // hyperfine separates its benchmarks with a line holding one space. Dropped
  // here, along with the blank lines around the fence below, so the block is
  // written in the shape `vp check --fix` leaves it in: otherwise every
  // regeneration fails the format check until the pre-commit hook rewrites it,
  // and the diff carries those lines as noise beside the numbers.
  const benchmarkSection = benchmarkStartMatch[0].trim().replace(/[ \t]+$/gm, "");

  return benchmarkSection;
}

async function getVersions() {
  console.log("Fetching versions...");
  try {
    const [prettier, biome, oxfmt, rsvelte] = await Promise.all([
      execAsync("vp exec prettier --version", { env: binEnv }),
      execAsync("vp exec biome --version", { env: binEnv }),
      execAsync("vp exec oxfmt --version", { env: binEnv }),
      execAsync("vp exec rsvelte-fmt --version", { env: binEnv }),
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

    // Where the measured binary came from, beside its version rather than inside
    // the string: the platform package the lockfile pins, or a TSV_BIN build.
    let tsvBinary = null;
    if (tsvSource === "TSV_BIN") {
      // A local build's version is a workspace constant that doesn't move
      // between builds, so it can't tell a binary built this morning from one
      // built months ago. Its mtime can. Local date, not toISOString(): a build
      // at 20:57 local reads as the next day in UTC, which wouldn't match
      // `git log --date=short` on the corpus line or the wall calendar of
      // whoever ran the benchmark.
      let built = null;
      try {
        built = (await stat(tsvBin)).mtime.toLocaleDateString("en-CA");
      } catch {
        // no binary to date
      }
      tsvBinary = { source: "TSV_BIN", built };
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
      tsvBinary = { source: "package", package: `@${name}` };
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

    // Asked of the `node` on the scenarios' PATH, not `process.version`: that is
    // the one every npm-bin row starts and the one `measureNodeStartup` times,
    // and a report that publishes the launch floor has to name what produced it.
    // Five of the rows here are a Node process, so a version change moves them
    // without any formatter having changed.
    let node = "unknown";
    try {
      const { stdout } = await execFileAsync("node", ["--version"], { env: binEnv });
      node = stdout.trim().replace(/^v/, "");
    } catch {
      // nothing to name; the rows that pay it are in the results either way
    }

    return {
      prettier: prettier.stdout.trim(),
      biome: biome.stdout.trim().replace("Version: ", ""),
      oxfmt: oxfmt.stdout.trim().replace("Version: ", ""),
      rsvelte: rsvelte.stdout.trim().replace("rsvelte_fmt ", ""),
      tsv,
      tsvBinary,
      tsvWasm,
      node,
    };
  } catch (error) {
    console.error("Error fetching versions:", error);
    process.exit(1);
  }
}

/** tsv's version as the README lists it, naming the binary's source. */
function formatTsvVersion({ tsv, tsvBinary }) {
  if (tsvBinary?.source === "package") return `${tsv} (${tsvBinary.package})`;
  if (tsvBinary?.source === "TSV_BIN") {
    return tsvBinary.built
      ? `${tsv} (TSV_BIN, binary built ${tsvBinary.built})`
      : `${tsv} (TSV_BIN)`;
  }
  return tsv;
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

  readmeContent = beforeMarker + "\n\n" + newBenchmarkContent + "\n\n" + afterMarker;

  // Update versions section. The trailing lines a README may predate — tsv-wasm,
  // Node, the machine — are optional in the match, so this still works against
  // one written before each existed.
  const versionsRegex =
    /## Versions\n\n- \*\*Prettier\*\*: .*\n- \*\*Biome\*\*: .*\n- \*\*Oxfmt\*\*: .*\n- \*\*rsvelte-fmt\*\*: .*\n- \*\*tsv\*\*: .*(\n- \*\*tsv-wasm\*\*: .*)?(\n- \*\*Node\*\*: .*)?(\n\n_Measured on: .*_)?/;
  // Node is listed with the formatters because five of the rows are a Node
  // process: both prettiers, tsv-npm, tsv-wasm, and the launchers biome and
  // rsvelte-fmt start with.
  const newVersionsContent = `## Versions\n\n- **Prettier**: ${versions.prettier}\n- **Biome**: ${versions.biome}\n- **Oxfmt**: ${versions.oxfmt}\n- **rsvelte-fmt**: ${versions.rsvelte}\n- **tsv**: ${formatTsvVersion(versions)}\n- **tsv-wasm**: ${versions.tsvWasm}\n- **Node**: ${versions.node}\n\n_Measured on: ${formatMachine(describeMachine())} — the ratios below depend on the core count._`;

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

/**
 * Compose what `results.json` holds: the run's numbers as data, beside the README's prose.
 *
 * Each scenario left a record in `results/` (see `shared/utils.mjs`), which
 * `bench-all.mjs` emptied before the run, so these are this run's and nothing
 * else's. They are joined here with the same versions and machine line the
 * README gets, in the order the scenarios ran. tsv.fuz.dev's generator reads
 * this file, so its keys are a consumed interface: `timestamp` (when the run
 * started), `git_commit` / `git_dirty` (see `describeHarness`), `machine` (see
 * `describeMachine`), `node_startup` (see `measureNodeStartup`), `versions`
 * keyed by formatter name plus the `node` the Node-launched rows ran on,
 * `tsv_binary` (where the native tsv rows' binary came from), and `scenarios` of
 * records.
 */
async function composeResults(versions, harness, runStartedAt) {
  const files = (await readdir(RESULTS_DIR)).filter((file) => file.endsWith(".json"));
  if (files.length === 0) {
    // Same reasoning as the versions list below: a README with fresh numbers
    // beside a results.json from an older run is worse than failing.
    throw new Error(`no scenario records in ${RESULTS_DIR} — the run recorded nothing`);
  }
  const records = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(RESULTS_DIR, file), "utf-8"))),
  );
  // `bench-all.mjs` empties `results/` first, but that is its promise, not this
  // script's: a run that never reached it (a cached `vp run` replaying old
  // output, say) would leave an earlier run's records to be published as this one's.
  const stale = records.filter((r) => !(r.started_at >= runStartedAt)).map((r) => r.scenario);
  if (stale.length > 0) {
    throw new Error(`records in ${RESULTS_DIR} predate this run: ${stale.join(", ")}`);
  }
  const scenarios = records
    .sort((a, b) => a.started_at - b.started_at)
    // run bookkeeping, not part of the published shape
    .map(({ scenario: _scenario, started_at: _startedAt, ...rest }) => rest);

  return {
    timestamp: new Date(runStartedAt).toISOString(),
    ...harness,
    machine: describeMachine(),
    node_startup: await measureNodeStartup(),
    versions: {
      prettier: versions.prettier,
      biome: versions.biome,
      oxfmt: versions.oxfmt,
      "rsvelte-fmt": versions.rsvelte,
      tsv: versions.tsv,
      "tsv-wasm": versions.tsvWasm,
      node: versions.node,
    },
    tsv_binary: versions.tsvBinary,
    scenarios,
  };
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
    const harness = await describeHarness();
    const runStartedAt = Date.now();
    const benchmarkOutput = await runBenchmark();
    const results = extractBenchmarkResults(benchmarkOutput);
    const versions = await getVersions();
    // Composed before the README is touched and written after it: both can
    // refuse (no records, no versions section), and each refuses before writing,
    // so a refusal leaves the pair as it was rather than one fresh and one stale.
    const data = await composeResults(versions, harness, runStartedAt);
    await updateReadme(results, versions);
    await writeFile("results.json", `${JSON.stringify(data, null, 2)}\n`);

    console.log("README and results.json have been updated with the latest benchmark results");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

void main();
