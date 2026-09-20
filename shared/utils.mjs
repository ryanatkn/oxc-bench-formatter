import { execSync, spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import { createRequire } from "module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const FORMATTER_NAMES = ["prettier", "prettier+oxc-parser", "biome", "oxfmt"];

// ---

/**
 * Where each scenario leaves its machine-readable record, one file per scenario
 * directory. Intermediate and gitignored: `bench-all.mjs` empties it before a
 * run so a composed report can't mix two runs, and
 * `bench-all-and-update-readme.mjs` composes the files into the committed
 * `results.json`.
 */
export const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../results");

/**
 * The scenario being recorded, or null before `printHeader` starts one.
 *
 * The record is the README block's numbers as data: tsv.fuz.dev reads
 * `results.json` rather than parsing the console dump, so what the README's
 * consumer used to scrape line by line — the banner title, the target, the run
 * counts, the preflight rows, hyperfine's timings, the memory table, an
 * `→ aborting:` line, an unshimmed row — is collected here by the same functions
 * that print it, and a scenario can't print one thing and record another. Keys
 * are snake_case and durations milliseconds, the shape that site's generator
 * validates; changing a key is a change to that contract.
 */
let record = null;

/** What `benchRunCounts` resolved, which runs at module scope, before any record exists. */
let resolvedRunCounts = null;

function beginRecord(title) {
  const name = title.replace(/^Benchmarking /, "");
  record = {
    // the scenario directory, which `setupCwd` has already made the cwd
    scenario: basename(process.cwd()),
    // the slug tsv.fuz.dev keys its per-scenario copy on
    id: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    name,
    started_at: Date.now(),
    target: "",
    corpus: "",
    // Seeded from `benchRunCounts` rather than left for hyperfine's argv to fill:
    // preflight aborts a scenario without ever reaching hyperfine, and for
    // `bench-svelte` that is the *common* outcome, so the record it publishes most
    // often would otherwise report the runs it printed as 0. Still 0 in upstream's
    // three scenarios until hyperfine finishes; they hard-code their counts.
    warmup_runs: resolvedRunCounts?.[0] ?? 0,
    benchmark_runs: resolvedRunCounts?.[1] ?? 0,
    // filled by `printRunCounts`, so it is present exactly in the scenarios that
    // settle and absent from upstream's three, which don't
    settle_seconds: undefined,
    preflight: [],
    aborted: undefined,
    unshimmed: [],
    timings: [],
    // the fastest timed row, which `speedups` are taken against — hyperfine's
    // choice, distinct from the fixed `baseline` the memory ratios anchor on
    fastest: "",
    speedups: [],
    memory: [],
  };
  // On exit rather than at the end of `main`: an aborted scenario throws out of
  // the middle of its run and exits non-zero, and its record — preflight rows and
  // the abort, no timings — is exactly what has to be published for it.
  process.once("exit", writeRecord);
}

function writeRecord() {
  const { aborted, unshimmed, ...rest } = record;
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    join(RESULTS_DIR, `${record.scenario}.json`),
    `${JSON.stringify(
      {
        ...rest,
        ...(aborted === undefined ? null : { aborted }),
        ...(unshimmed.length === 0 ? null : { unshimmed }),
      },
      null,
      2,
    )}\n`,
  );
}

/** Empty `RESULTS_DIR`, so the records in it afterwards all come from one run. */
export function clearResults() {
  rmSync(RESULTS_DIR, { recursive: true, force: true });
}

// Records carry more digits than the console prints, not all of them: a
// microsecond and a kilobyte are below anything these runs resolve, and rounding
// there keeps a regenerated `results.json` diff to the digits that moved.
export const round = (value, digits) => Number(value.toFixed(digits));

/**
 * A ratio of two measured means with its uncertainty, both operands' relative
 * error propagated in quadrature (the standard first-order form for a quotient:
 * sigma_r/r = sqrt((sigma_a/a)^2 + (sigma_b/b)^2)) — so the uncertainty reflects
 * the spread of both the formatter and the baseline, not just one. hyperfine's
 * `Summary` uses the same form.
 */
function ratioOf(result, baseline) {
  const ratio = result.mean / baseline.mean;
  const rel = Math.hypot(result.stddev / result.mean, baseline.stddev / baseline.mean);
  return { ratio, stddev: ratio * rel };
}

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

/** tsv's two Node-launched distributions: the package and the script its `tsv` bin names. */
const TSV_NODE_BINS = {
  "tsv-npm": { pkg: "@fuzdev/tsv", script: "bin.js" },
  "tsv-wasm": { pkg: "@fuzdev/tsv-wasm", script: "cli.js" },
};

/**
 * The command for one of tsv's Node-launched rows, through a bin shim of the
 * same shape every other tool's row goes through.
 *
 * prettier, biome, oxfmt and rsvelte-fmt are run as `node_modules/.bin/<tool>`,
 * which under pnpm is a generated `sh` script (`dirname`, `sed`, `uname`,
 * `command -v node`, then `exec node <script>`) costing ~3 ms per invocation.
 * tsv's two rows can't use theirs: `@fuzdev/tsv` and `@fuzdev/tsv-wasm` both
 * declare a `tsv` bin and pnpm links only one (the package name that sorts
 * higher, so the WASM one). Running them as `node <script>` instead would skip
 * those ~3 ms — an edge no other row gets, and ~6% of tsv-npm on a single file.
 *
 * So each row gets a shim of its own, `node_modules/.bin/bench-<row>`, derived
 * from the `.bin/tsv` pnpm did write: that script with its package's paths
 * swapped for this row's. Copying the live shim rather than carrying a template
 * is the point — the cost tracks whatever pnpm version installed the others. It
 * lives in `.bin/` because the shim addresses its target relative to itself.
 *
 * Returns `{command, shim}`. `shim` is false when no pnpm shim could be derived
 * (another package manager, a package missing, a shim whose shape moved); the
 * command then falls back to `node <script>` by path, and `warnUnshimmedTsvRows`
 * says so in the scenario's output rather than let the difference pass unseen.
 */
export function resolveTsvNodeBin(projectRoot, row) {
  const { pkg, script } = TSV_NODE_BINS[row];
  const modules = resolve(projectRoot, "node_modules");
  const fallback = { command: `node ${projectRoot}/node_modules/${pkg}/${script}`, shim: false };
  try {
    const template = readFileSync(join(modules, ".bin/tsv"), "utf8");
    // pnpm's cmd-shim signs its scripts with the target it execs; without the
    // trailer this is a symlink or another manager's script, and not the cost
    // the other rows pay.
    const target = /^# cmd-shim-target=(.+)$/m.exec(template)?.[1];
    // pnpm addresses the package either through the hoisted `node_modules/<pkg>`
    // symlink or through the store path that symlink points at, and which one it
    // writes has moved between installs of the same pnpm — so identify the
    // package by what the path resolves to, not by how it is spelled.
    // Null rather than throwing on a path that isn't there: the other row's
    // package being uninstalled must not cost *this* row its shim.
    const realOf = (path) => {
      try {
        return realpathSync(path);
      } catch {
        return null;
      }
    };
    const targetReal = target && realOf(target);
    const from =
      targetReal &&
      Object.values(TSV_NODE_BINS).find(
        (bin) => targetReal === realOf(join(modules, bin.pkg, bin.script)),
      );
    if (!from) return fallback;

    // The template names its package as a directory in four spellings — hoisted
    // and store, each absolute (the trailer, NODE_PATH) and relative to `.bin/`
    // (the exec lines) — plus NODE_PATH's store `node_modules` one level up.
    // Rewrite `<dir>/<script>` for each before the bare `<dir>`, and longest
    // first within each group, so a prefix never rewrites its own tail.
    const dirs = (bin) => {
      const real = realOf(join(modules, bin.pkg));
      return (
        real && [real, join(modules, bin.pkg), `../${relative(modules, real)}`, `../${bin.pkg}`]
      );
    };
    const storeModules = (real, name) => real.slice(0, -`/${name}`.length);
    const [fromDirs, toDirs] = [dirs(from), dirs(TSV_NODE_BINS[row])];
    // This row's own package has to be installed for a shim to point anywhere.
    if (!fromDirs || !toDirs) return fallback;
    const fromReal = fromDirs[0];
    const toReal = toDirs[0];
    const swaps = [
      ...fromDirs.map((dir, i) => [`${dir}/${from.script}`, `${toDirs[i]}/${script}`]),
      ...fromDirs.map((dir, i) => [dir, toDirs[i]]),
      [storeModules(fromReal, from.pkg), storeModules(toReal, pkg)],
    ];
    const text = swaps.reduce((t, [a, b]) => t.replaceAll(a, b), template);

    // A shim that still names the other package, or whose exec lines don't all
    // land on this row's script, is a shim for the wrong distribution under this
    // row's name. Resolve what each exec line actually points at rather than
    // matching a spelling, for the same reason the target is resolved above.
    const other = Object.values(TSV_NODE_BINS).find((bin) => bin.pkg !== pkg);
    const execs = [...text.matchAll(/^\s*exec .*$/gm)].map((m) => m[0]);
    // `wanted` null would make every unresolvable exec line compare equal to it,
    // i.e. read a shim pointing at nothing as valid — so require it up front.
    const wanted = realOf(join(toReal, script));
    const lands = (line) => {
      const arg = /"\$basedir(?:_win)?\/([^"]+)"\s+"\$@"/.exec(line)?.[1];
      return arg != null && realOf(resolve(modules, ".bin", arg)) === wanted;
    };
    if (
      !wanted ||
      execs.length === 0 ||
      !execs.every(lands) ||
      text.includes(`${other.pkg}/${other.script}`)
    ) {
      return fallback;
    }

    const path = join(modules, `.bin/bench-${row}`);
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
    chmodSync(path, 0o755);
    return { command: `${projectRoot}/node_modules/.bin/bench-${row}`, shim: true };
  } catch {
    return fallback;
  }
}

/**
 * Say so when a tsv row in `names` is running by path instead of through a shim.
 * Printed into the scenario's output, so a published table whose tsv rows skipped
 * the launch cost the others paid carries that fact with it, and recorded, so
 * tsv.fuz.dev shows it under the table too.
 */
export function warnUnshimmedTsvRows(projectRoot, names) {
  for (const row of names.filter((name) => name in TSV_NODE_BINS)) {
    if (!resolveTsvNodeBin(projectRoot, row).shim) {
      if (record && !record.unshimmed.includes(row)) record.unshimmed.push(row);
      console.log(
        `- ${row}: no pnpm bin shim to copy — run as \`node <script>\`, skipping the ~3 ms shim the .bin rows pay`,
      );
    }
  }
}

export { FORMATTER_NAMES };

export function setupCwd(importMetaUrl) {
  const __dirname = dirname(fileURLToPath(importMetaUrl));
  process.chdir(__dirname);
}

/**
 * What a benchmark run reads off disk, and the one step that puts it there.
 *
 * Every network access in this suite lives in `./init.sh`: `pnpm install`, the
 * shallow clones of outline (twice), storybook and continue, the pinned
 * `parser.ts` download, and the fuzdev/corpora fetch `setup-corpus.mjs` falls
 * back to when there is no sibling checkout. Nothing downstream of it goes to
 * the network — the formatters are all installed, the corpora are all local, and
 * the version strings come from the binaries and manifests already on disk — so
 * the machine can be disconnected between setup and the run.
 *
 * That only holds if the run refuses to do setup itself. `bench-all.mjs` used to
 * shell out to `init.sh` whenever a corpus was missing, which put the whole
 * network step inside the thing it was supposed to precede, and made an offline
 * `update-readme` fail minutes in rather than up front.
 */
const REQUIRED_CORPORA = [
  ["bench-large-single-file/data/parser.ts", "TypeScript v5.9.2 parser.ts"],
  ["bench-js-no-embedded/data", "outline clone"],
  ["bench-mixed-embedded/data", "storybook clone"],
  ["bench-full-features/data", "continue clone"],
  ["bench-ts-only/data", "outline clone (second checkout)"],
  ["bench-svelte/data", "pinned .svelte snapshot (node ./bench-svelte/setup-corpus.mjs)"],
  ["bench-tsv-delivery/data/parser.ts", "TypeScript v5.9.2 parser.ts (second copy)"],
];

/**
 * Everything a run needs that isn't in place, one line each; empty when ready.
 *
 * The one list both ends of setup read: `assertBenchReady` refuses a run on it,
 * and `init.sh` closes on it, so "Setup complete" can't be printed over a clone
 * that failed or a corpus the run is about to refuse. hyperfine is on it because
 * every scenario needs it — GNU time is not, since without it only the memory
 * pass is skipped.
 */
export function missingBenchSetup(projectRoot = ".") {
  const missing = [];
  if (!existsSync(join(projectRoot, "node_modules"))) {
    missing.push("node_modules/ — dependencies not installed (pnpm install)");
  }
  for (const [path, what] of REQUIRED_CORPORA) {
    if (!existsSync(join(projectRoot, path))) missing.push(`${path} — ${what}`);
  }
  if (spawnSync("hyperfine", ["--version"]).error) {
    missing.push(
      "hyperfine — not on PATH, and not something init.sh installs (apt/brew install hyperfine)",
    );
  }
  return missing;
}

/**
 * Refuse to start a run that isn't set up, naming what's missing and the one
 * command that fetches it.
 *
 * Exits rather than throws, and lists every missing piece rather than the first,
 * so a single online `./init.sh` clears the lot.
 */
export function assertBenchReady(projectRoot = ".") {
  const missing = missingBenchSetup(projectRoot);
  if (!missing.length) return;

  console.error("Not set up to benchmark:");
  for (const line of missing) console.error(`  - ${line}`);
  console.error("");
  console.error(
    "Run `./init.sh` (or `pnpm run setup`) while online; the run itself needs no network.",
  );
  process.exit(1);
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
  resolvedRunCounts = [
    readRunCount("BENCH_WARMUP", warmupDefault, 0),
    readRunCount("BENCH_RUNS", runsDefault, 1),
  ];
  return [...resolvedRunCounts];
}

/**
 * Seconds to idle before each command's set of timing runs (hyperfine `--setup`,
 * which runs once per command, before its warmups) — a thermal settle. hyperfine
 * runs the commands in the order given with no interleaving, so on a machine that
 * throttles each later command starts warmer than the one before it; a pause
 * between commands lets the package cool toward the same starting point every
 * row gets. Per command rather than per run (`--prepare`) because between-row
 * drift is the bias the fixed order creates, and a per-run sleep would cost
 * hundreds of them for within-row noise the mean already averages. Override with
 * `BENCH_SETTLE_S`; `0` disables it.
 */
const SETTLE_SECONDS = readRunCount("BENCH_SETTLE_S", 10, 0);

/** The `--setup` argument pair for `SETTLE_SECONDS`, or nothing when it is off. */
export function settleArgs() {
  return SETTLE_SECONDS > 0 ? ["--setup", `sleep ${SETTLE_SECONDS}`] : [];
}

/**
 * Print a settling scenario's run counts and settle, and record all three.
 *
 * Every knob a run can be started with has to leave a mark on what that run
 * publishes, or two runs taken at different settings read alike — the reason the
 * counts are printed rather than assumed from the defaults. The settle is the
 * same kind of knob (`BENCH_SETTLE_S`, `0` disables) and moves the numbers the
 * same way, so it rides on the same line and into the same record.
 *
 * The counts come from `benchRunCounts` rather than the caller, so the line and
 * the record can't disagree: a scenario passing its own numbers could print the
 * defaults over an override the record already has.
 *
 * The settle is recorded here rather than in `settleArgs`, which a scenario
 * preflight aborts never reaches: it describes how that run's numbers were to be
 * taken, as the seeded counts do.
 */
export function printRunCounts() {
  if (resolvedRunCounts === null) {
    // upstream's three scenarios hard-code their counts and call neither this nor
    // `benchRunCounts`; a settling scenario that skipped it would print counts
    // nothing resolved
    throw new Error("printRunCounts() before benchRunCounts() resolved the counts");
  }
  const [warmup, runs] = resolvedRunCounts;
  if (record) record.settle_seconds = SETTLE_SECONDS;
  const settle = SETTLE_SECONDS > 0 ? `, ${SETTLE_SECONDS}s settle before each formatter` : "";
  console.log(`- ${warmup} warmup runs, ${runs} benchmark runs${settle}`);
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
  // signals — how anyone who installs tsv from npm runs it. Run through a bin
  // shim of the harness's own, as the WASM CLI is (below): both packages claim
  // the `tsv` bin name — see `resolveTsvNodeBin`.
  const tsvNpmBin = resolveTsvNodeBin(projectRoot, "tsv-npm").command;
  // rsvelte-fmt (@rsvelte/fmt) is an npm bin wrapping a native binary: it
  // formats .svelte in-process and delegates every other file to oxfmt. On the
  // .svelte-only bench-svelte corpus that oxfmt leg spawns on zero files — the
  // startup cost is part of its shipped directory posture, so it stays.
  const rsvelteBin = `${projectRoot}/node_modules/.bin/rsvelte-fmt`;
  // rsvelte-fmt ships an on-disk cache of formatted `<style>` blocks and an oxfmt
  // daemon, both serving only its DELEGATED CSS path (`--no-native-css`): on the
  // default in-process path it writes no cache (verified at 0.7.23 — a run over
  // the bench-svelte corpus with `RSVELTE_FMT_CACHE_DIR` pointed at an empty dir
  // leaves it empty, and no `~/.cache/rsvelte-fmt` exists on the machine that
  // produced results.json) and leaves no daemon behind. Pinned off anyway, so a
  // release that widened the cache to the native path could not hand this row
  // warm state tsv's rows have no counterpart to; timed with and without, the
  // pins move nothing measurable on the native path.
  const rsvelteEnv = "RSVELTE_FMT_NO_CACHE=1 RSVELTE_FMT_NO_DAEMON=1";
  // @fuzdev/tsv-wasm ships tsv's CLI as a Node script over the WASM engine —
  // one source, shipped verbatim as the bin of that package and as the native
  // @fuzdev/tsv's fallback. Not run as `node_modules/.bin/tsv`, because both
  // packages claim that bin name: which one owns it is the package manager's
  // call (pnpm: the package name that sorts higher, so this one today), and this
  // row has to be the WASM one every time.
  const tsvWasmCli = resolveTsvNodeBin(projectRoot, "tsv-wasm").command;

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
    "tsv-wasm": (files) => `${tsvWasmCli} format ${files}`,

    // The native binary again, reached the way `npx tsv` reaches it: through
    // @fuzdev/tsv's Node dispatcher. Same output as the tsv row plus one Node
    // cold start and a spawn — the delivery cost this row exists to measure.
    "tsv-npm": (files) => `${tsvNpmBin} format ${files}`,

    // Unlike tsv, rsvelte-fmt is configurable; the scenario's oxfmtrc.json pins
    // it to tsv's fixed style (printWidth 100, tabs, single quotes, no trailing
    // commas) so break decisions and output volume are comparable.
    rsvelte: (files) => `${rsvelteEnv} ${rsvelteBin} --config ${configDir}/oxfmtrc.json ${files}`,

    // Check-mode counterparts: identical scope and config, no writes. Preflight
    // reads their diagnostics to learn which files each formatter rejects.
    check: {
      prettier: (files, configFile = "prettierrc.json") =>
        `${prettierBin} ${files} --check --config ${configDir}/${configFile} --ignore-path ${configDir}/prettierignore --ignore-unknown`,

      biome: (files) =>
        `${biomeBin} format --files-ignore-unknown=true --config-path ${configDir} ${files}`,

      oxfmt: (files) => `${oxfmtBin} --check --config ${configDir}/oxfmtrc.json ${files}`,

      tsv: (files) => `${tsvBin} format --check ${files}`,

      "tsv-wasm": (files) => `${tsvWasmCli} format --check ${files}`,

      "tsv-npm": (files) => `${tsvNpmBin} format --check ${files}`,

      rsvelte: (files) =>
        `${rsvelteEnv} ${rsvelteBin} --check --config ${configDir}/oxfmtrc.json ${files}`,
    },
  };
}

/**
 * Where a corpus came from, printed and recorded with each scenario's target.
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

    // The scope numbers ride on the same line, after the status word.
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

  // One row per formatter checked, in run order — never for the self-test's
  // `quiet` passes, which check fixtures rather than a scenario's corpus.
  if (record && !quiet) {
    record.preflight = checks.map(({ name }) => ({
      name,
      rejected: failures[name]?.length ?? 0,
      unavailable: unavailable.includes(name),
      crashed: crashed.includes(name),
    }));
  }

  if (problems.length > 0) {
    // Abort rather than time a comparison that is no longer apples-to-apples.
    log("  → aborting: this scenario would not measure every formatter on the same work");
    // The record gets the problems themselves: its rows name a rejection, a launch
    // failure or a crash, and this says the rest (a scope mismatch, an idle
    // formatter, an unreadable count).
    if (record && !quiet) record.aborted = problems.join("; ");
    // The report rides along so a caller that catches (the self-test) can see
    // which formatter failed and how, not just the summary line.
    throw Object.assign(new Error(`preflight failed — ${problems.join("; ")}`), { report });
  }

  log("  → all formatters accept the whole corpus; nothing excluded");

  return report;
}

// ---

/**
 * Run hyperfine, and record what it measured.
 *
 * The console output is unchanged; the numbers are read from hyperfine's own
 * `--export-json` rather than scraped back out of it, so the record carries full
 * precision and the run counts the scenario actually passed.
 */
export function runHyperfine(args) {
  const exportPath = join(tmpdir(), `bench-formatter-hyperfine-${process.pid}.json`);
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      // A timed run that fails stops the scenario before any number exists, which
      // the record has to say or it reads as a scenario with nothing under it.
      if (record) record.aborted = `a timed run failed — ${error.message}`;
      reject(error);
    };
    const proc = spawn("hyperfine", [`--export-json=${exportPath}`, ...args], {
      stdio: "inherit",
    });
    // A missing hyperfine is a spawn error, not an exit code; without this it
    // surfaces as an unhandled event rather than the scenario's own failure.
    proc.on("error", fail);
    proc.on("close", (code, signal) => {
      if (code !== 0) {
        fail(new Error(`Hyperfine failed with ${signal ? `signal ${signal}` : `code ${code}`}`));
        return;
      }
      try {
        if (record) recordTimings(args, JSON.parse(readFileSync(exportPath, "utf8")).results);
        resolve();
      } catch (error) {
        fail(error);
      } finally {
        rmSync(exportPath, { force: true });
      }
    });
  });
}

function recordTimings(args, results) {
  const count = (flag) => Number(args.find((arg) => arg.startsWith(`--${flag}=`))?.split("=")[1]);
  record.warmup_runs = count("warmup");
  record.benchmark_runs = count("runs");

  // hyperfine reports seconds, and a lone run (`BENCH_RUNS=1`) has no spread
  const SECONDS_TO_MS = 1000;
  const ms = (seconds) => round((seconds ?? 0) * SECONDS_TO_MS, 3);
  // `command` is the `-n` name when one was given, which every scenario does
  record.timings = results.map((r) => ({
    name: r.command,
    mean_ms: ms(r.mean),
    stddev_ms: ms(r.stddev),
    min_ms: ms(r.min),
    max_ms: ms(r.max),
    user_ms: ms(r.user),
    system_ms: ms(r.system),
  }));

  // hyperfine's `Summary`: the fastest command, and how much slower each other
  // one ran, nearest first. It is printed but not exported, so it is recomputed
  // here from the same means.
  const stats = results.map((r) => ({ name: r.command, mean: r.mean, stddev: r.stddev ?? 0 }));
  const fastest = stats.reduce((a, b) => (b.mean < a.mean ? b : a));
  record.fastest = fastest.name;
  record.speedups = stats
    .filter((r) => r !== fastest)
    .sort((a, b) => a.mean - b.mean)
    .map((r) => {
      const { ratio, stddev } = ratioOf(r, fastest);
      return { name: r.name, ratio: round(ratio, 4), ratio_stddev: round(stddev, 4) };
    });
}

// ---

/**
 * Run one scenario's rows through all three passes: preflight, timing, memory.
 *
 * `rows` is `[{name, command, check}]` — the write command that gets timed and
 * its check-mode counterpart — in the order they run. One list instead of the
 * three parallel ones upstream's scenarios carry (preflight entries, hyperfine's
 * `-n` names and commands, memory entries), so a row can't be added to one pass
 * and missed in another. The fork-added scenarios use it; upstream's keep
 * upstream's shape, to hold the merge surface down.
 *
 * Order matters and native tsv goes last: hyperfine runs the commands as given
 * without interleaving, so on a machine that throttles, later rows meet a warmer
 * one — keeping that bias pointed against tsv rather than for it.
 *
 * Timing runs without `--ignore-failure`: preflight has already confirmed every
 * formatter accepts the whole corpus, so the corpus reasons a formatter would
 * exit non-zero are ruled out before timing starts. What's left is a real crash,
 * which must fail the scenario rather than be timed as a fast partial run — and
 * `failOnCrash` holds the memory pass to the same rule. Memory ratios are taken
 * against `baseline`.
 *
 * @throws if preflight fails, a timed run exits non-zero, or a memory run crashes
 */
export async function benchRows(rows, { projectRoot, warmup, runs, prepare, baseline }) {
  warnUnshimmedTsvRows(
    projectRoot,
    rows.map((row) => row.name),
  );

  runPreflight(rows.map(({ name, check }) => ({ name, command: check })));

  await runHyperfine([
    `--warmup=${warmup}`,
    `--runs=${runs}`,
    ...settleArgs(),
    "--prepare",
    prepare,
    "--shell=bash",
    ...rows.map((row) => `-n=${row.name}`),
    ...rows.map((row) => row.command),
  ]);

  await runMemoryBenchmarks(
    rows.map(({ name, command }) => ({ name, command, prepare })),
    runs,
    { baseline, failOnCrash: true },
  );
}

// ---

// Print benchmark header, and start the scenario's record
export function printHeader(title) {
  beginRecord(title);
  console.log("");
  console.log("=========================================");
  console.log(title);
  console.log("=========================================");
}

/** Print the scenario's one-line corpus label, and record it. */
export function printTarget(target) {
  if (record) record.target = target;
  console.log(`Target: ${target}`);
}

/**
 * Print the scenario's corpus provenance, and record it.
 *
 * Takes the text rather than the path, since `bench-svelte` composes its pin with
 * the snapshot's own commit. Recorded for the same reason it is printed: without
 * it a consumer of `results.json` can say what was measured but not which
 * revision of the corpus it was measured on, and the cloned corpora move.
 */
export function printCorpus(corpus) {
  if (record) record.corpus = corpus;
  console.log(`Corpus: ${corpus}`);
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

  // Measure everything before printing or recording anything, so an abort
  // leaves no half-written table: a scenario's memory is published whole or as
  // the abort that replaced it.
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
    if (record) {
      record.aborted = `${detail} — a crash must fail the scenario, not thin its row`;
    }
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
    const against = anchor && result !== anchor ? ratioOf(result, anchor) : null;
    if (against) {
      parts.push(
        `${against.ratio.toFixed(2)} ± ${against.stddev.toFixed(2)} times more than ${anchor.name}`,
      );
    }
    console.log(`  ${result.name}: ${result.mean.toFixed(1)} MB (${parts.join(", ")})`);
    // the same rows as data: a formatter whose every run failed has none, here as there
    record?.memory.push({
      name: result.name,
      mean_mb: round(result.mean, 3),
      min_mb: round(result.min, 3),
      max_mb: round(result.max, 3),
      ...(against
        ? { ratio: round(against.ratio, 4), ratio_stddev: round(against.stddev, 4) }
        : null),
    });
  }
  if (!anchor) {
    console.log(`  → ${baseline} was not measured, so the rows above carry no ratios`);
  }

  // After the rows: a row built from fewer runs than the header promised has to say so, or a
  // formatter that crashes on part of the corpus publishes a clean-looking mean.
  for (const result of crashed) {
    console.log(
      `  → ${result.name}: ${result.crashes} of ${result.runs} runs crashed (killed by a signal) — excluded from its row`,
    );
  }

  return results;
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
// `%M` is the largest single process in the command's tree, not the tree's sum
// (ru_maxrss is a max over waited-for children). A Node launcher plus the native
// binary it spawns therefore reads as whichever is bigger: biome and rsvelte-fmt
// as their binary, tsv-npm as its ~50 MB dispatcher.
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
