import { execSync, spawn } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";

const FORMATTER_NAMES = ["prettier", "prettier+oxc-parser", "biome", "oxfmt"];

export { FORMATTER_NAMES };

export function setupCwd(importMetaUrl) {
  const __dirname = dirname(fileURLToPath(importMetaUrl));
  process.chdir(__dirname);
}

export function createFormatters(projectRoot, configDir) {
  const prettierBin = `${projectRoot}/node_modules/.bin/prettier`;
  const biomeBin = `${projectRoot}/node_modules/.bin/biome`;
  const oxfmtBin = `${projectRoot}/node_modules/.bin/oxfmt`;
  // tsv is a native Rust binary from the sibling tsv repo, not an npm bin.
  // Override with the TSV_BIN env var; the default resolves the release build
  // checked out next to this repo (../tsv relative to the project root).
  const tsvBin = process.env.TSV_BIN ?? `${projectRoot}/../tsv/target/release/tsv`;

  // NOTE: Do not use `--experimental-cli`, as it seems to behave differently than the stable CLI...
  return {
    prettier: (files, configFile = "prettierrc.json") =>
      `${prettierBin} ${files} --write --config ${configDir}/${configFile} --ignore-path ${configDir}/prettierignore --ignore-unknown`,

    biome: (files) =>
      `${biomeBin} format --write --files-ignore-unknown=true --config-path ${configDir} ${files}`,

    oxfmt: (files) => `${oxfmtBin} --config ${configDir}/oxfmtrc.json ${files}`,

    // tsv is non-configurable (no config file or flags) and formats paths in
    // place — directory args recurse over the JS/TS family (.ts/.mts/.cts/.js/
    // .mjs/.cjs), .svelte, and .css. It has no JSX/TSX parser, so a .jsx/.tsx
    // file is never discovered and JSX inside a .js file is a parse error.
    tsv: (files) => `${tsvBin} format ${files}`,

    // Check-mode counterparts: identical scope and config, no writes. Preflight
    // reads their diagnostics to learn which files each formatter rejects.
    check: {
      prettier: (files, configFile = "prettierrc.json") =>
        `${prettierBin} ${files} --check --config ${configDir}/${configFile} --ignore-path ${configDir}/prettierignore --ignore-unknown`,

      biome: (files) =>
        `${biomeBin} format --files-ignore-unknown=true --config-path ${configDir} ${files}`,

      oxfmt: (files) => `${oxfmtBin} --check --config ${configDir}/oxfmtrc.json ${files}`,

      tsv: (files) => `${tsvBin} format --check ${files}`,
    },
  };
}

// ---

// Per-formatter check-mode commands and the patterns that pull a failing file
// path out of each one's diagnostics. Every formatter here reports parse errors
// on stderr/stdout with the path in a tool-specific shape, so preflight needs one
// matcher per tool rather than a shared format.
const PREFLIGHT_MATCHERS = {
  prettier: /^\[error\] (.+?): /gm, // [error] path: SyntaxError: ...
  "prettier+oxc-parser": /^\[error\] (.+?): /gm,
  biome: /^(.+?):\d+:\d+ parse /gm, // path:1:11 parse ━━━━━
  oxfmt: /,-\[(.+?):\d+:\d+\]/g, // miette snippet header
  tsv: /^error: (.+?): /gm, // error: path: message
};

/**
 * Find the files each formatter cannot process, so a scenario benches every tool
 * on the set they all accept.
 *
 * Without this, a formatter that *errors* on part of the corpus is still timed
 * (hyperfine runs with `--ignore-failure`), so rejecting files reads as speed.
 * The tools disagree on real corpora — tsv has no JSX parser, so a `.js` file
 * carrying JSX is a parse error for tsv and ordinary input for prettier, biome,
 * and oxfmt.
 *
 * Returns `{failures, excluded}` — per-formatter failing paths, and their union.
 * Reports what it found; never silently drops anything.
 */
export async function runPreflight(checks, cwd = ".") {
  console.log("");
  console.log("Preflight (per-formatter parse check):");

  const failures = {};
  const excluded = new Set();
  const unavailable = [];

  for (const { name, command } of checks) {
    let output = "";
    let launchFailed = false;
    try {
      output = execSync(`${command} 2>&1`, { encoding: "utf8", stdio: "pipe", cwd });
    } catch (error) {
      // check mode exits non-zero for "would change" and for real errors alike,
      // so a normal non-zero exit carries no signal — the diagnostics do. But a
      // 126/127 (or a spawn ENOENT) means the command never launched: a missing
      // binary (e.g. tsv on a CI runner that never built it) must read as
      // "unavailable", never be mistaken for "clean" for lack of a matcher hit.
      launchFailed = error.status === 126 || error.status === 127 || error.code === "ENOENT";
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }

    if (launchFailed) {
      failures[name] = [];
      unavailable.push(name);
      console.log(`  ${name}: unavailable (command failed to launch)`);
      continue;
    }

    const matcher = PREFLIGHT_MATCHERS[name];
    const paths = matcher ? [...output.matchAll(matcher)].map((m) => m[1]) : [];
    const unique = [...new Set(paths.map((p) => p.replace(/^\.\//, "")))];
    failures[name] = unique;
    for (const p of unique) excluded.add(p);

    console.log(`  ${name}: ${unique.length === 0 ? "clean" : `${unique.length} rejected`}`);
    for (const p of unique.slice(0, 5)) console.log(`      ${p}`);
    if (unique.length > 5) console.log(`      … and ${unique.length - 5} more`);
  }

  for (const name of unavailable) {
    console.log(`  → ${name} could not run — its benchmark row below is meaningless, not a pass`);
  }
  if (excluded.size === 0 && unavailable.length === 0) {
    console.log("  → all formatters accept the whole corpus; nothing excluded");
  } else if (excluded.size > 0) {
    console.log(`  → excluding ${excluded.size} file(s) rejected by at least one formatter`);
  }

  return { failures, excluded: [...excluded], unavailable };
}

// ---

// Run hyperfine benchmark
export function runHyperfine(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("hyperfine", args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Hyperfine failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

// ---

// Print benchmark header
export function printHeader(title) {
  console.log("");
  console.log("=========================================");
  console.log(title);
  console.log("=========================================");
}

// ---

// Run memory benchmarks
export async function runMemoryBenchmarks(benchmarks, runs) {
  console.log("");
  console.log("Memory Usage:");

  const results = [];
  for (const bench of benchmarks) {
    const result = await measureMemory(bench.name, bench.command, bench.prepare, runs);
    if (result) {
      results.push(result);
    }
  }

  // Nothing measured (no GNU time, or every command failed) — `checkGnuTime`
  // already warned, so leave the section empty rather than reducing over [].
  if (results.length === 0) {
    return results;
  }

  // Print results, each relative to the lowest-memory formatter — the same
  // baseline-and-ratio shape hyperfine uses for timing, so the memory section
  // reads the same way. The baseline itself carries no ratio (it would be 1.00x).
  const baseline = results.reduce((lowest, r) => (r.mean < lowest.mean ? r : lowest));
  for (const result of results) {
    const parts = [`min: ${result.min.toFixed(1)} MB`, `max: ${result.max.toFixed(1)} MB`];
    if (result !== baseline) {
      parts.push(`${format_ratio(result, baseline)} times more than ${baseline.name}`);
    }
    console.log(`  ${result.name}: ${result.mean.toFixed(1)} MB (${parts.join(", ")})`);
  }

  return results;
}

// Ratio of two measured means as `x ± y`, propagating both operands' relative
// error in quadrature (the standard first-order form for a quotient:
// sigma_r/r = sqrt((sigma_a/a)^2 + (sigma_b/b)^2)) — so the uncertainty reflects
// the spread of both the formatter and the baseline, not just one.
function format_ratio(result, baseline) {
  const ratio = result.mean / baseline.mean;
  const rel = Math.hypot(result.stddev / result.mean, baseline.stddev / baseline.mean);
  return `${ratio.toFixed(2)} ± ${(ratio * rel).toFixed(2)}`;
}

// Detect GNU time binary
let gnuTimeBinary = null;
try {
  execSync("gtime --version", { stdio: "ignore" });
  gnuTimeBinary = "gtime";
} catch {
  try {
    execSync("/usr/bin/time --version", { stdio: "ignore" });
    gnuTimeBinary = "/usr/bin/time";
  } catch {
    // GNU time not available
  }
}

// Check GNU time availability and print warning if not found
export function checkGnuTime() {
  if (!gnuTimeBinary) {
    console.warn("Warning: GNU time not found. Memory benchmarking will be skipped.");
    console.warn("Install GNU time to enable memory benchmarking:");
    console.warn("  macOS: brew install gnu-time (installs as gtime)");
    console.warn("  Linux: apt install time or yum install time");
    return false;
  }
  return true;
}

// Memory measurement function
async function measureMemory(name, command, prepareCmd, runs) {
  const measurements = [];

  for (let i = 0; i < runs; i++) {
    // Run prepare command if provided
    if (prepareCmd) {
      try {
        execSync(prepareCmd, { stdio: "ignore" });
      } catch {
        // Ignore prepare errors
      }
    }

    // Run the command with GNU time to measure memory
    try {
      if (!gnuTimeBinary) {
        return null;
      }
      const escapedCommand = command.replace(/'/g, "'\\''");
      const output = execSync(`${gnuTimeBinary} -f '%M' sh -c '${escapedCommand}' 2>&1 | tail -1`, {
        encoding: "utf8",
        stdio: "pipe",
      });
      const memKB = Number.parseInt(output.trim(), 10);
      if (!Number.isNaN(memKB)) {
        measurements.push(memKB);
      }
    } catch {
      // Continue on error
    }
  }

  if (measurements.length === 0) {
    return null;
  }

  // Calculate statistics. Values stay numeric (MB) so callers can derive ratios;
  // formatting happens at print time.
  measurements.sort((a, b) => a - b);
  const mean = measurements.reduce((a, b) => a + b, 0) / measurements.length;
  // sample standard deviation (n-1), matching hyperfine's convention; a single
  // run has no spread, so it reports 0 rather than NaN
  const variance =
    measurements.length > 1
      ? measurements.reduce((acc, m) => acc + (m - mean) ** 2, 0) / (measurements.length - 1)
      : 0;

  const KB_TO_MB = 1024;
  return {
    name,
    mean: mean / KB_TO_MB,
    min: measurements[0] / KB_TO_MB,
    max: measurements[measurements.length - 1] / KB_TO_MB,
    stddev: Math.sqrt(variance) / KB_TO_MB,
  };
}
