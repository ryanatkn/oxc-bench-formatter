import { execSync, spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
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
  // rsvelte-fmt (@rsvelte/fmt) is an npm bin wrapping a native binary: it
  // formats .svelte in-process and delegates every other file to oxfmt. On the
  // .svelte-only bench-svelte corpus that oxfmt leg spawns on zero files — the
  // startup cost is part of its shipped directory posture, so it stays.
  const rsvelteBin = `${projectRoot}/node_modules/.bin/rsvelte-fmt`;

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

    // Unlike tsv, rsvelte-fmt is configurable; the scenario's oxfmtrc.json pins
    // it to tsv's fixed style (printWidth 100, tabs, single quotes, no trailing
    // commas) so break decisions and output volume are comparable.
    rsvelte: (files) => `${rsvelteBin} --config ${configDir}/oxfmtrc.json ${files}`,

    // Check-mode counterparts: identical scope and config, no writes. Preflight
    // reads their diagnostics to learn which files each formatter rejects.
    check: {
      prettier: (files, configFile = "prettierrc.json") =>
        `${prettierBin} ${files} --check --config ${configDir}/${configFile} --ignore-path ${configDir}/prettierignore --ignore-unknown`,

      biome: (files) =>
        `${biomeBin} format --files-ignore-unknown=true --config-path ${configDir} ${files}`,

      oxfmt: (files) => `${oxfmtBin} --check --config ${configDir}/oxfmtrc.json ${files}`,

      tsv: (files) => `${tsvBin} format --check ${files}`,

      rsvelte: (files) => `${rsvelteBin} --check --config ${configDir}/oxfmtrc.json ${files}`,
    },
  };
}

/**
 * Where a corpus came from, printed with each scenario's target.
 *
 * The cloned corpora track their upstream default branches, so the same scenario
 * run months apart can be a different repository — a difference that otherwise
 * leaves no trace in the published numbers. A commit and date (or, for the single
 * downloaded file, its size and content hash) makes a rerun comparable, or
 * visibly not.
 */
export function describeCorpus(target) {
  try {
    if (statSync(target).isDirectory()) {
      if (!existsSync(`${target}/.git`)) {
        // Also worth saying out loud: a corpus directory that isn't its own git
        // root is the state in which tsv's discovery reads the OUTER repo's
        // .gitignore, which ignores bench-*/data/, and finds nothing.
        return "not a git checkout — provenance unknown";
      }
      return execSync(`git -C ${target} log -1 --format='%h %cd' --date=short`, {
        encoding: "utf8",
      }).trim();
    }
    const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
    return `${statSync(target).size} bytes, sha256:${digest.slice(0, 12)}`;
  } catch (error) {
    return `unknown (${error.message})`;
  }
}

/**
 * Assert a scenario's three scoping files name the same extensions.
 *
 * `prettierignore`, oxfmt's `ignorePatterns`, and biome's `files.includes` each
 * express the same intent in a different dialect, and nothing links them: add an
 * extension to one and the scenario quietly benches that formatter on more files
 * than the others. Preflight's file-count comparison catches this too, but only
 * once a corpus actually contains the extension — this catches it at edit time,
 * with no corpus and no tool runs.
 *
 * Only for the allowlist shape this fork writes (`!*.ts`, `**\/*.ts`). Upstream's
 * scenarios use bare `!*ts` patterns, which also match `.mts` and any file ending
 * in "ts", so they are deliberately not checked here.
 *
 * @throws if the three disagree, or any of them allows nothing
 */
export function assertScopeConfigsAgree(configDir) {
  const read = (file) => readFileSync(`${configDir}/${file}`, "utf8");

  // Lines that carry no extension by design: deny-everything, re-include
  // directories, comments, blanks.
  const BOILERPLATE = /^(\*|!\*\/|#.*)?$/;

  // A pattern matching neither the allowlist shape nor that boilerplate is
  // reported, not skipped: a pattern this can't read is a pattern it isn't
  // checking, and passing anyway would be the exact failure it exists to prevent.
  const unreadable = [];
  const collect = (file, patterns, shape) => {
    const found = new Set();
    for (const pattern of patterns.map((p) => p.trim())) {
      const match = shape.exec(pattern);
      if (match) found.add(match[1]);
      else if (!BOILERPLATE.test(pattern)) unreadable.push(`${file}: ${pattern}`);
    }
    return found;
  };

  const sets = {
    prettierignore: collect("prettierignore", read("prettierignore").split("\n"), /^!\*(\.\w+)$/),
    "oxfmtrc.json": collect(
      "oxfmtrc.json",
      JSON.parse(read("oxfmtrc.json")).ignorePatterns ?? [],
      /^!\*(\.\w+)$/,
    ),
    "biome.json": collect(
      "biome.json",
      JSON.parse(read("biome.json")).files?.includes ?? [],
      /^\*\*\/\*(\.\w+)$/,
    ),
  };

  if (unreadable.length > 0) {
    throw new Error(
      `scope configs use patterns this check can't read, so it isn't checking them\n    ${unreadable.join("\n    ")}`,
    );
  }

  const describe = (set) => [...set].sort((a, b) => a.localeCompare(b)).join(" ") || "(nothing)";
  const [reference, ...others] = Object.values(sets);
  const agree = others.every(
    (set) => set.size === reference.size && [...set].every((ext) => reference.has(ext)),
  );

  if (reference.size === 0 || !agree) {
    const detail = Object.entries(sets)
      .map(([file, set]) => `${file}: ${describe(set)}`)
      .join("\n    ");
    throw new Error(
      `scope configs disagree — the formatters would not be scoped to the same files\n    ${detail}`,
    );
  }

  console.log(`Scope configs agree: ${describe(reference)}`);
}

// ---

// Per-formatter check-mode commands and the patterns that pull a failing file
// path out of each one's diagnostics. Every formatter here reports parse errors
// on stderr/stdout with the path in a tool-specific shape, so preflight needs one
// matcher per tool rather than a shared format.

// A path in one of the extensions any formatter here is pointed at. Matchers
// whose prefix is not unique to a diagnostic line anchor on this: prettier
// echoes the offending source lines under the same `[error] ` prefix, so an
// unanchored capture reads `[error]   1 | const o = { alpha: 1 }` as a rejected
// file named "  1 | const o = { alpha" — inflating the count with garbage paths
// on exactly the corpus preflight exists to catch.
const SOURCE_PATH = String.raw`.+?\.(?:[cm]?[jt]sx?|svelte|css)`;

const PREFLIGHT_MATCHERS = {
  // [error] path: SyntaxError: ...
  prettier: new RegExp(String.raw`^\[error\] (${SOURCE_PATH}): `, "gm"),
  "prettier+oxc-parser": new RegExp(String.raw`^\[error\] (${SOURCE_PATH}): `, "gm"),
  biome: /^(.+?):\d+:\d+ parse /gm, // path:1:11 parse ━━━━━
  oxfmt: /,-\[(.+?):\d+:\d+\]/g, // miette snippet header
  // error: path: message — continuation lines carry no `error: ` prefix, but
  // anchor anyway so a pathless diagnostic can never register as a file.
  tsv: new RegExp(String.raw`^error: (${SOURCE_PATH}): `, "gm"),
  // Anchored on the .svelte extension so summary lines ("rsvelte-fmt: would
  // reformat N files") can never read as a rejected path. Note this covers only
  // rsvelte-fmt's own Svelte leg; diagnostics from the oxfmt it delegates other
  // files to arrive in oxfmt's format, which is fine while the corpus is
  // .svelte-only.
  "rsvelte-fmt": /^rsvelte-fmt: (.+?\.svelte): /gm, // rsvelte-fmt: path: rsvelte_formatter error: ...
};

// Patterns saying "this tool reported an error" without naming a file. A check
// command can fail at the command level rather than per file — an unresolvable
// plugin, a bad config, a path that matched nothing — and every such failure
// leaves the matcher above with nothing to capture, so the formatter reads as
// clean and is then timed doing no work at all. With `--ignore-failure` that
// posts as an extraordinary speed.
//
// Only tools whose error prefix is unambiguous in check mode are listed. biome
// calls formatting diffs "errors" and oxfmt's failure text names no file, so
// neither has a signal that couldn't fire on an ordinary run — a command-level
// failure in those two still reads as clean. `preflight-selftest.mjs` records
// exactly which formatters are covered.
// How each tool reports the size of the job it just did.
//
// `considered` is how many files it looked at. Those numbers must agree: the
// formatters are scoped by three unrelated mechanisms (`prettierignore`, oxfmt
// `ignorePatterns`, biome `files.includes`) plus tsv's own extension walk, so a
// corpus that grows a new file type — or an allowlist edited in one place and not
// the others — silently benches different tools on different work. Checking the
// counts against each other turns that into an abort. prettier reports no such
// count, so it sits out the comparison.
//
// `changed` is how many files it would rewrite. Zero means it did no work at all,
// which is not a fast formatter but an empty one: a `prettierignore` whose
// allowlist stopped matching prints "All matched files use Prettier code style!"
// and exits 0, and the timed run that follows measures process startup.
//
// A count that stops matching reads as "unknown", never as agreement —
// `preflight-selftest.mjs` verifies every pattern here against fixtures.
const PREFLIGHT_SCOPE_COUNTS = {
  // Counted from prettier's one-line-per-file `[warn] path` output rather than its
  // summary sentence, which has two shapes ("in N files" / "in the above file")
  // and none at all when there is nothing to change. Anchored on a source
  // extension so the summary line itself — same `[warn] ` prefix — isn't counted.
  prettier: { changed: countPrettierWarnings },
  "prettier+oxc-parser": { changed: countPrettierWarnings },
  biome: {
    considered: /^Checked (\d+) files? in /m,
    changed: /^Found (\d+) errors?\.$/m, // format-only run: "errors" are formatting diffs
  },
  oxfmt: {
    considered: /^Finished in .+ on (\d+) files?/m,
    changed: /^Format issues found in above (\d+) files?/m,
  },
  tsv: {
    // "N would change, M unchanged[, K errors]" — the whole set it walked.
    considered: (output) => {
      const m = /^(\d+) would change, (\d+) unchanged(?:, (\d+) errors?)?/m.exec(output);
      return m ? Number(m[1]) + Number(m[2]) + Number(m[3] ?? 0) : null;
    },
    changed: /^(\d+) would change/m,
  },
  "rsvelte-fmt": {
    considered: /would reformat \d+ \/ (\d+) files/m,
    changed: /would reformat (\d+) \/ \d+ files/m,
  },
};

const PRETTIER_WARNED_FILE = new RegExp(String.raw`^\[warn\] (${SOURCE_PATH})$`, "gm");

function countPrettierWarnings(output) {
  const warned = [...output.matchAll(PRETTIER_WARNED_FILE)].length;
  if (warned > 0) return warned;
  // Distinguish "nothing to change" from "the output shape moved": the first is
  // a corpus fact, the second means this count can't be trusted at all.
  return /All matched files use Prettier code style!/.test(output) ? 0 : null;
}

/** Read one count out of a check command's output; null when it isn't there. */
function readCount(spec, output) {
  if (!spec) return null;
  if (typeof spec === "function") return spec(output);
  const match = spec.exec(output);
  return match ? Number(match[1]) : null;
}

const PREFLIGHT_ERROR_SIGNALS = {
  prettier: /^\[error\] /m,
  "prettier+oxc-parser": /^\[error\] /m,
  tsv: /^error: /m,
};

/**
 * Confirm every formatter accepts the whole corpus before any of them is timed,
 * and abort the scenario if one does not.
 *
 * Without this, a formatter that *errors* on part of the corpus is still timed
 * (hyperfine runs with `--ignore-failure`), so rejecting files reads as speed.
 * The tools disagree on real corpora — tsv has no JSX parser, so a `.js` file
 * carrying JSX is a parse error for tsv and ordinary input for prettier, biome,
 * and oxfmt.
 *
 * Rejections are not filtered out and the run continued: the three formatters
 * are scoped by three separate mechanisms (`prettierignore`, oxfmt
 * `ignorePatterns`, biome `files.includes`), so narrowing the set mid-run would
 * mean generating per-run configs and publishing numbers for a corpus that no
 * longer matches its own description. A corpus one formatter can't take is a
 * corpus to fix, not to quietly shrink.
 *
 * Also cross-checks scope: every formatter that reports a file count must report
 * the same one, and every formatter must have at least one file to change.
 *
 * Returns `{failures, excluded, unavailable, crashed, unmatched, errored,
 * oversized, counts}` on a clean pass. Reports everything it found before
 * throwing; never silently drops anything. `quiet` suppresses that reporting and
 * is meant for
 * `preflight-selftest.mjs`, which drives this function many times over fixtures
 * and prints its own summary; the thrown error carries the same report as
 * `error.report` either way.
 *
 * @throws if any formatter rejects a file, fails to launch, crashes mid-check,
 * errors without naming a file, has no diagnostic matcher to read, finds nothing
 * to change, or disagrees with the others about how many files are in scope
 */
export async function runPreflight(checks, { quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;

  log("");
  log("Preflight (per-formatter parse check):");

  const failures = {};
  const excluded = new Set();
  const unavailable = [];
  const crashed = [];
  const unmatched = [];
  const errored = [];
  const oversized = [];
  const counts = {};

  for (const { name, command } of checks) {
    let output = "";
    let launchFailed = false;
    let crashStatus = null;
    let truncated = false;
    try {
      // execSync defaults to a 1MB buffer, and overflowing it throws ENOBUFS with
      // a partial stdout and no exit status — diagnostics would be silently cut
      // off and read as fewer rejections. A check pass over a large corpus prints
      // a line per file (prettier does), so raise the ceiling and treat an
      // overflow as unreadable rather than as a result.
      output = execSync(`${command} 2>&1`, {
        encoding: "utf8",
        stdio: "pipe",
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch (error) {
      truncated = error.code === "ENOBUFS";
      // check mode exits non-zero for "would change" and for real errors alike,
      // so a normal non-zero exit carries no signal — the diagnostics do. But a
      // 126/127 (or a spawn ENOENT) means the command never launched: a missing
      // binary (e.g. tsv on a CI runner that never built it) must read as
      // "unavailable", never be mistaken for "clean" for lack of a matcher hit.
      launchFailed = error.status === 126 || error.status === 127 || error.code === "ENOENT";
      // 128+n is the conventional killed-by-signal encoding (a shell reports a
      // SIGABRT child as 134; the rsvelte-fmt launcher propagates its native
      // binary's signal the same way). A crash mid-check means the diagnostics
      // are incomplete, so "no matcher hits" must not read as "clean".
      crashStatus = typeof error.status === "number" && error.status >= 128 ? error.status : null;
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }

    if (launchFailed) {
      failures[name] = [];
      unavailable.push(name);
      log(`  ${name}: unavailable (command failed to launch)`);
      continue;
    }

    if (truncated) {
      failures[name] = [];
      oversized.push(name);
      log(`  ${name}: output too large to capture — diagnostics incomplete`);
      continue;
    }

    if (crashStatus !== null) {
      failures[name] = [];
      crashed.push(name);
      log(`  ${name}: CRASHED during check (exit ${crashStatus})`);
      continue;
    }

    const matcher = PREFLIGHT_MATCHERS[name];
    if (!matcher) {
      // No matcher means nothing can be read out of this formatter's
      // diagnostics, so "clean" would be an assumption, not a finding — the one
      // outcome preflight exists to rule out. A formatter added to a scenario
      // without a matcher fails here rather than passing by default.
      failures[name] = [];
      unmatched.push(name);
      log(`  ${name}: UNKNOWN — no diagnostic matcher, coverage unverified`);
      continue;
    }

    // Normalize to cwd-relative so the union below counts files, not spellings:
    // tsv prints `./data/x.ts`, prettier and biome `data/x.ts`, rsvelte-fmt an
    // absolute path — the same rejected file in three shapes.
    const paths = [...output.matchAll(matcher)].map((m) => relative(process.cwd(), resolve(m[1])));
    const unique = [...new Set(paths)];
    failures[name] = unique;
    for (const p of unique) excluded.add(p);

    if (unique.length === 0 && PREFLIGHT_ERROR_SIGNALS[name]?.test(output)) {
      errored.push(name);
      log(`  ${name}: ERRORED — reported an error it attributed to no file`);
      continue;
    }

    const scope = PREFLIGHT_SCOPE_COUNTS[name] ?? {};
    const considered = readCount(scope.considered, output);
    const changed = readCount(scope.changed, output);
    counts[name] = { considered, changed, reportsConsidered: scope.considered !== undefined };

    // The scope numbers ride on the same line, after the status word the README
    // consumer reads.
    const scopeNote = [
      considered === null ? null : `${considered} file${considered === 1 ? "" : "s"}`,
      changed === null ? null : `${changed} would change`,
    ].filter(Boolean);
    const suffix = scopeNote.length > 0 ? ` (${scopeNote.join(", ")})` : "";

    log(`  ${name}: ${unique.length === 0 ? "clean" : `${unique.length} rejected`}${suffix}`);
    for (const p of unique.slice(0, 5)) log(`      ${p}`);
    if (unique.length > 5) log(`      … and ${unique.length - 5} more`);
  }

  for (const name of unavailable) {
    log(`  → ${name} could not run — a benchmark row for it would be meaningless, not a pass`);
  }
  for (const name of crashed) {
    log(
      `  → ${name} crashed partway through its check — its coverage is unknown and its timed runs may crash too`,
    );
  }
  for (const name of unmatched) {
    log(`  → ${name} has no matcher in PREFLIGHT_MATCHERS — add one before benching it`);
  }
  for (const name of oversized) {
    log(
      `  → ${name} printed more than could be captured — raise maxBuffer in runPreflight before trusting this corpus`,
    );
  }
  for (const name of errored) {
    log(
      `  → ${name} failed at the command level, not on a file — check its config, plugins, and paths`,
    );
  }

  const problems = [];
  if (excluded.size > 0) {
    problems.push(`${excluded.size} file(s) rejected by at least one formatter`);
  }
  if (unavailable.length > 0) problems.push(`unavailable: ${unavailable.join(", ")}`);
  if (crashed.length > 0) problems.push(`crashed: ${crashed.join(", ")}`);
  if (unmatched.length > 0) problems.push(`no diagnostic matcher: ${unmatched.join(", ")}`);
  if (errored.length > 0) problems.push(`errored without naming a file: ${errored.join(", ")}`);
  if (oversized.length > 0) problems.push(`output too large to capture: ${oversized.join(", ")}`);

  // Every formatter must have work to do. A count that didn't parse is treated as
  // no work rather than waved through — for prettier that IS the zero-scope
  // report ("All matched files use Prettier code style!"), and for the others it
  // means the line changed shape and the number can't be trusted.
  const idle = Object.entries(counts)
    .filter(([, c]) => !c.changed)
    .map(([name]) => name);
  if (idle.length > 0) {
    log(
      `  → ${idle.join(", ")} found nothing to change — either mis-scoped, or about to be timed doing no work`,
    );
    problems.push(`no files to format: ${idle.join(", ")}`);
  }

  // Every formatter that reports a file count must report the same one.
  const scopes = Object.entries(counts).filter(([, c]) => c.reportsConsidered);
  const unreadable = scopes.filter(([, c]) => c.considered === null).map(([name]) => name);
  if (unreadable.length > 0) {
    problems.push(`file count unreadable: ${unreadable.join(", ")}`);
  }
  const sizes = new Set(scopes.map(([, c]) => c.considered).filter((n) => n !== null));
  if (sizes.size > 1) {
    const detail = scopes.map(([name, c]) => `${name} ${c.considered}`).join(", ");
    log(`  → scope mismatch: ${detail} — the formatters are not benching the same files`);
    problems.push(`scope mismatch (${detail})`);
  }

  const report = {
    failures,
    excluded: [...excluded],
    unavailable,
    crashed,
    unmatched,
    errored,
    oversized,
    counts,
  };

  if (problems.length > 0) {
    // Abort rather than time a comparison that is no longer apples-to-apples.
    log("  → aborting: this scenario would not measure every formatter on the same work");
    // The report rides along so a caller that catches (the self-test) can see
    // which formatter failed and how, not just the summary line.
    throw Object.assign(new Error(`preflight failed — ${problems.join("; ")}`), { report });
  }

  log("  → all formatters accept the whole corpus; nothing excluded");

  return report;
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
  const unmeasured = [];
  for (const bench of benchmarks) {
    const result = await measureMemory(bench.name, bench.command, bench.prepare, runs);
    if (result) {
      results.push(result);
    } else {
      // Say so rather than omitting the row. A formatter whose every run failed
      // would otherwise just be absent from the table below, which reads as "not
      // benched" at a glance and as nothing at all to a parser.
      unmeasured.push(bench.name);
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
  for (const name of unmeasured) {
    console.log(`  ${name}: not measured (every run failed)`);
  }

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
