import { execSync, spawn } from "child_process";
import { createHash } from "crypto";
import { createRequire } from "module";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const FORMATTER_NAMES = ["prettier", "prettier+oxc-parser", "biome", "oxfmt"];

/**
 * The native tsv binary to bench, and where it came from.
 *
 * `TSV_BIN` wins when set — that is how a dev build or a pinned copy is benched.
 * Otherwise the binary is the one `@fuzdev/tsv` installed for this machine: its
 * platform package (`@fuzdev/tsv-<triple>`) ships the same `tsv_cli` binary its
 * release workflow builds with the release profile a local build uses, so the
 * measured artifact is the published one, version-pinned by the lockfile like
 * every other formatter here and installable on CI. pnpm installs only the
 * matching optional dependency and does not hoist it, so it is resolved the way
 * the package's own `bin.js` does — from the real location of `@fuzdev/tsv`,
 * trying each platform package it declares — rather than by guessing a triple.
 *
 * Always returns a path: when nothing resolves, one that does not exist under the
 * package's directory, so a scenario's preflight reports tsv unavailable with a
 * path in the message rather than running whatever `tsv` is on PATH.
 */
export function resolveTsv(projectRoot) {
  if (process.env.TSV_BIN) {
    return { bin: process.env.TSV_BIN, source: "TSV_BIN" };
  }
  const packageJson = `${projectRoot}/node_modules/@fuzdev/tsv/package.json`;
  let manifest;
  let realPath;
  try {
    realPath = realpathSync(packageJson);
    manifest = JSON.parse(readFileSync(realPath, "utf8"));
  } catch {
    return { bin: `${projectRoot}/node_modules/@fuzdev/tsv/<not installed>/tsv`, source: null };
  }
  const require = createRequire(realPath);
  const exe = process.platform === "win32" ? "tsv.exe" : "tsv";
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    let bin;
    try {
      bin = join(dirname(require.resolve(name)), exe);
    } catch {
      continue;
    }
    if (existsSync(bin)) {
      return { bin, source: `${name}@${manifest.optionalDependencies[name]}` };
    }
  }
  return {
    bin: `${dirname(realPath)}/<no platform package for ${process.platform}-${process.arch}>/tsv`,
    source: null,
  };
}

export { FORMATTER_NAMES };

export function setupCwd(importMetaUrl) {
  const __dirname = dirname(fileURLToPath(importMetaUrl));
  process.chdir(__dirname);
}

/**
 * A scenario's warmup and benchmark run counts, overridable for a quick
 * low-accuracy smoke run: `BENCH_WARMUP=0 BENCH_RUNS=1 node ./bench-ts-only/bench.mjs`.
 *
 * Returns `[warmup, runs]` — the order hyperfine takes them and the order every
 * scenario prints them, so an override always shows up in the header line and
 * can't be mistaken for a full run in a scraped README.
 *
 * Both are validated rather than passed through. hyperfine *hangs* on
 * `--runs=0` and rejects `--runs=NaN`, so an unchecked env typo would either
 * wedge the scenario or fail it deep inside a run, well after the corpus setup.
 * A warmup of 0 is the whole point of a smoke run; a benchmark run count of 0 is
 * never meant.
 */
export function benchRunCounts(warmupDefault, runsDefault) {
  return [
    readRunCount("BENCH_WARMUP", warmupDefault, 0),
    readRunCount("BENCH_RUNS", runsDefault, 1),
  ];
}

function readRunCount(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    // Exit rather than throw: this runs at module scope, before the scenario's
    // `main().catch()` exists, so a throw would answer a typo'd env var with a
    // stack trace. Matches how the scenarios report a missing corpus.
    console.error(`${name} must be an integer >= ${min}, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return value;
}

export function createFormatters(projectRoot, configDir) {
  const prettierBin = `${projectRoot}/node_modules/.bin/prettier`;
  const biomeBin = `${projectRoot}/node_modules/.bin/biome`;
  const oxfmtBin = `${projectRoot}/node_modules/.bin/oxfmt`;
  // tsv is a native Rust binary, not an npm bin: the platform package's `tsv`
  // (or `TSV_BIN`) — see `resolveTsv`.
  const tsvBin = resolveTsv(projectRoot).bin;
  // `@fuzdev/tsv`'s own `tsv` bin is a Node dispatcher that resolves that same
  // platform binary and spawnSyncs it, forwarding argv, stdio, exit codes and
  // signals — how anyone who installs tsv from npm runs it. Addressed by path
  // for the same reason the WASM CLI is (below): both packages claim the `tsv`
  // bin name.
  const tsvNpmBin = `${projectRoot}/node_modules/@fuzdev/tsv/bin.js`;
  // rsvelte-fmt (@rsvelte/fmt) is an npm bin wrapping a native binary: it
  // formats .svelte in-process and delegates every other file to oxfmt. On the
  // .svelte-only bench-svelte corpus that oxfmt leg spawns on zero files — the
  // startup cost is part of its shipped directory posture, so it stays.
  const rsvelteBin = `${projectRoot}/node_modules/.bin/rsvelte-fmt`;
  // @fuzdev/tsv_wasm ships tsv's CLI as a Node script over the WASM engine —
  // one source, shipped verbatim as the bin of that package and as the native
  // @fuzdev/tsv's fallback. Addressed by explicit path rather than through
  // `node_modules/.bin/tsv`, because both packages claim that same bin name:
  // which one owns the shim is the package manager's call, and this row has to
  // be the WASM one every time.
  const tsvWasmCli = `${projectRoot}/node_modules/@fuzdev/tsv_wasm/cli.js`;

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

    // Same CLI contract as the native binary — subcommands, flags, exit codes,
    // traversal and ignore rules, diagnostics — over the WASM engine instead.
    // Since tsv 0.3 it fans multi-file runs onto node:worker_threads above a
    // file-count threshold; on a single file it is one thread. Also
    // non-configurable, so it takes no config argument either.
    "tsv-wasm": (files) => `node ${tsvWasmCli} format ${files}`,

    // The native binary again, reached the way `npx tsv` reaches it: through
    // @fuzdev/tsv's Node dispatcher. Same output as the tsv row plus one Node
    // cold start and a spawn — the delivery cost this row exists to measure.
    "tsv-npm": (files) => `node ${tsvNpmBin} format ${files}`,

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

      "tsv-wasm": (files) => `node ${tsvWasmCli} format --check ${files}`,

      "tsv-npm": (files) => `node ${tsvNpmBin} format --check ${files}`,

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

const TSV_DIAGNOSTIC = new RegExp(String.raw`^error: (${SOURCE_PATH}): `, "gm");

const PREFLIGHT_MATCHERS = {
  // [error] path: SyntaxError: ...
  prettier: new RegExp(String.raw`^\[error\] (${SOURCE_PATH}): `, "gm"),
  "prettier+oxc-parser": new RegExp(String.raw`^\[error\] (${SOURCE_PATH}): `, "gm"),
  biome: /^(.+?):\d+:\d+ parse /gm, // path:1:11 parse ━━━━━
  oxfmt: /,-\[(.+?):\d+:\d+\]/g, // miette snippet header
  // error: path: message — continuation lines carry no `error: ` prefix, but
  // anchor anyway so a pathless diagnostic can never register as a file.
  tsv: TSV_DIAGNOSTIC,
  // The WASM CLI is the same source as the native binary's, so it prints the
  // same diagnostics — shared here rather than copied so the two can't drift
  // apart in this table while the tool keeps them identical.
  "tsv-wasm": TSV_DIAGNOSTIC,
  // The dispatcher forwards the native binary's stdio verbatim.
  "tsv-npm": TSV_DIAGNOSTIC,
  // Anchored on the .svelte extension so summary lines ("rsvelte-fmt: would
  // reformat N files") can never read as a rejected path. Note this covers only
  // rsvelte-fmt's own Svelte leg; diagnostics from the oxfmt it delegates other
  // files to arrive in oxfmt's format, which is fine while the corpus is
  // .svelte-only.
  "rsvelte-fmt": /^rsvelte-fmt: (.+?\.svelte): /gm, // rsvelte-fmt: path: rsvelte_formatter error: ...
};

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
const TSV_SCOPE_COUNTS = {
  // "N would change, M unchanged[, K errors]" — the whole set it walked.
  considered: (output) => {
    const m = /^(\d+) would change, (\d+) unchanged(?:, (\d+) errors?)?/m.exec(output);
    return m ? Number(m[1]) + Number(m[2]) + Number(m[3] ?? 0) : null;
  },
  changed: /^(\d+) would change/m,
};

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
  tsv: TSV_SCOPE_COUNTS,
  "tsv-wasm": TSV_SCOPE_COUNTS,
  "tsv-npm": TSV_SCOPE_COUNTS,
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
const PREFLIGHT_ERROR_SIGNALS = {
  prettier: /^\[error\] /m,
  "prettier+oxc-parser": /^\[error\] /m,
  tsv: /^error: /m,
  // Same `error: ` prefix as the native CLI, plus Node's own module-resolution
  // failure: this row is a script addressed by path, so an uninstalled or moved
  // package exits 1 with no diagnostics at all — which would otherwise read as a
  // formatter that found nothing wrong.
  "tsv-wasm": /^error: |^Error: Cannot find module /m,
  // A path-addressed script too, with one more failure of its own: the
  // dispatcher warns and falls back to the JS CLI when it can't run the native
  // binary, which would time the wrong distribution under this row's name.
  "tsv-npm":
    /^error: |^Error: Cannot find module |^warning: @fuzdev\/tsv could not run its native CLI/m,
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
export function runPreflight(checks, { quiet = false } = {}) {
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
    // A missing hyperfine is a spawn error, not an exit code; without this it
    // surfaces as an unhandled event rather than the scenario's own failure.
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Hyperfine failed with ${signal ? `signal ${signal}` : `code ${code}`}`));
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

/**
 * Measure each benchmark's peak RSS and print the `Memory Usage:` table.
 *
 * `baseline` names the formatter every other row's ratio is taken against — a
 * fixed choice per scenario (tsv where tsv runs, oxfmt in upstream's three),
 * never whichever tool happened to use least this run: a baseline that moves
 * between regenerations makes the ratio column incomparable across READMEs,
 * which is exactly what it exists for. Required; its own row carries no ratio,
 * and a ratio below 1 means less memory than the baseline.
 *
 * `failOnCrash` makes a run killed by a signal abort the scenario — printed as
 * an `→ aborting:` line and thrown, before any row is printed — the memory
 * counterpart of timing without `--ignore-failure`. Without it, such runs are
 * excluded from their row and reported under the table.
 */
export async function runMemoryBenchmarks(benchmarks, runs, { baseline, failOnCrash = false }) {
  if (!benchmarks.some((bench) => bench.name === baseline)) {
    throw new Error(
      `memory baseline ${JSON.stringify(baseline)} is not one of the benchmarked formatters`,
    );
  }

  // Measure everything before printing anything, so an abort leaves no
  // half-written table: the README's consumer reads a `Memory Usage:` heading
  // with no rows under it as a parse failure, and no heading as "not measured".
  const measured = [];
  for (const bench of benchmarks) {
    const result = await measureMemory(bench.name, bench.command, bench.prepare, runs);
    // Null only without GNU time — `checkGnuTime` already warned.
    if (result) measured.push(result);
  }
  if (measured.length === 0) return [];

  const crashed = measured.filter((r) => r.crashes > 0);
  if (failOnCrash && crashed.length > 0) {
    const detail = crashed
      .map((r) => `${r.name} crashed (killed by a signal) in ${r.crashes} of ${r.runs} memory runs`)
      .join("; ");
    console.log("");
    console.log(`  → aborting: ${detail} — a crash must fail the scenario, not thin its row`);
    throw new Error(`memory measurement failed — ${detail}`);
  }

  console.log("");
  console.log("Memory Usage:");

  // Say so rather than omitting the row. A formatter whose every run failed
  // would otherwise just be absent from the table below, which reads as "not
  // benched" at a glance and as nothing at all to a parser.
  for (const result of measured) {
    if (result.mean === null) console.log(`  ${result.name}: not measured (every run failed)`);
  }

  const results = measured.filter((r) => r.mean !== null);
  const anchor = results.find((r) => r.name === baseline);
  for (const result of results) {
    const parts = [`min: ${result.min.toFixed(1)} MB`, `max: ${result.max.toFixed(1)} MB`];
    if (anchor && result !== anchor) {
      parts.push(`${format_ratio(result, anchor)} times more than ${anchor.name}`);
    }
    console.log(`  ${result.name}: ${result.mean.toFixed(1)} MB (${parts.join(", ")})`);
  }
  if (!anchor) {
    console.log(`  → ${baseline} was not measured, so the rows above carry no ratios`);
  }

  // After the rows, so the rows keep the shape the README's consumer parses: a
  // row built from fewer runs than the header promised has to say so, or a
  // formatter that crashes on part of the corpus publishes a clean-looking mean.
  for (const result of crashed) {
    console.log(
      `  → ${result.name}: ${result.crashes} of ${result.runs} runs crashed (killed by a signal) — excluded from its row`,
    );
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

// Peak RSS of `command` over `runs` runs, or null without GNU time.
//
// Returns `{name, runs, crashes, mean, min, max, stddev}` — `mean` (and the rest)
// null when no run produced a measurement, `crashes` the number of runs the
// command died from a signal in, which are excluded: the peak RSS of a process
// that was killed partway is not the cost of the job, and a nondeterministic
// SIGABRT (rsvelte-fmt has one) would otherwise average in unremarked. A run
// that exits non-zero on its own — a formatter erroring on some file, which the
// timed pass tolerates too under `--ignore-failure` — did the whole job, so its
// peak counts.
async function measureMemory(name, command, prepareCmd, runs) {
  if (!gnuTimeBinary) {
    return null;
  }

  const measurements = [];
  let crashes = 0;

  for (let i = 0; i < runs; i++) {
    // Run prepare command if provided
    if (prepareCmd) {
      try {
        execSync(prepareCmd, { stdio: "ignore" });
      } catch {
        // Ignore prepare errors
      }
    }

    // GNU time prints its `%M` line after the command's own output (merged in
    // here) and exits with the command's status — 128+n when the command was
    // killed by a signal. Read that status rather than pipe through `tail -1`,
    // whose pipeline status is always zero: that turned a SIGABRT-killed run
    // into an ordinary measurement.
    const escapedCommand = command.replace(/'/g, "'\\''");
    let output;
    try {
      output = execSync(`${gnuTimeBinary} -f '%M' sh -c '${escapedCommand}' 2>&1`, {
        encoding: "utf8",
        stdio: "pipe",
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch (error) {
      if (typeof error.status === "number" && error.status >= 128) {
        crashes++;
        continue;
      }
      output = typeof error.stdout === "string" ? error.stdout : "";
    }
    const memKB = Number.parseInt(output.trim().split("\n").at(-1) ?? "", 10);
    if (!Number.isNaN(memKB)) {
      measurements.push(memKB);
    }
  }

  if (measurements.length === 0) {
    return { name, runs, crashes, mean: null, min: null, max: null, stddev: null };
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
    runs,
    crashes,
    mean: mean / KB_TO_MB,
    min: measurements[0] / KB_TO_MB,
    max: measurements[measurements.length - 1] / KB_TO_MB,
    stddev: Math.sqrt(variance) / KB_TO_MB,
  };
}
