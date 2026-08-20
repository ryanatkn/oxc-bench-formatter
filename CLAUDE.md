# CLAUDE.md

Navigation aid for this repo. The upstream agent guidance lives in
[AGENTS.md](AGENTS.md) (this file used to be a symlink to it); this file is the
fuller working map, including the tsv integration this fork adds.

## What this is

A benchmark suite comparing JS/TS formatters on **execution time** (via
[hyperfine](https://github.com/sharkdp/hyperfine)) and **peak memory / RSS**
(via GNU `time`). Formatters compared:

- **prettier** (`prettier --write`)
- **prettier+oxc-parser** (prettier with `@prettier/plugin-oxc`)
- **biome** (`biome format --write`)
- **oxfmt** (`oxfmt`)
- **tsv** (`tsv format`) — native Rust, JS/TS family + CSS/Svelte, no JSX/TSX;
  runs only in the non-JSX scenarios (`bench-ts-only`,
  `bench-large-single-file`, `bench-svelte`). This is the fork's addition over upstream.
- **rsvelte-fmt** (`rsvelte-fmt`) — `@rsvelte/fmt`, Rust Svelte formatter that
  formats `.svelte` in-process and delegates other files to oxfmt; runs only in
  `bench-svelte`, head-to-head with tsv. Also fork-added.

This suite measures the whole **CLI** (process spawn + I/O + multi-file parallel
batch + RSS). A complementary fork,
`../oxc-bench-javascript-parser-written-in-rust`, benchmarks the **parsers**
(oxc, swc, tsv) **in-process** via Rust/criterion — parse throughput + RSS, no
process or I/O overhead. There tsv is wired in as a `../tsv/crates/tsv_ts` path
dependency (not a binary) and, for the same JSX/keyword reasons, runs on a single
`.ts` file; see that repo's `CLAUDE.md`.

All sources are ESM `.mjs`. No test framework or hand-rolled linter — quality
gating is delegated to **vite-plus** (`vp`): `prepare` runs `vp config`, staged
files run `vp check --fix` (see `vite.config.ts`), and `.vite-hooks/pre-commit`
runs `vp staged`. Package manager is pnpm 11.4.0; Node is pinned to `24`.

## Deviations from upstream

What a merge from `oxc-project/bench-formatter` has to reconcile. Everything else
is upstream's, untouched.

- **Two formatters added**: tsv (native binary, `TSV_BIN`) and rsvelte-fmt.
- **Two scenarios added**: `bench-ts-only`, `bench-svelte` — plus their entries in
  `bench-all.mjs` and `init.sh`.
- **`bench-large-single-file`** (upstream's) gained a tsv row, a preflight pass,
  tsv's style profile on the other four formatters, and lost `--ignore-failure`
  because preflight makes it redundant.
- **`bench-full-features`** (upstream's): oxfmt's `printWidth` raised to 100 to
  match the prettier width upstream already set there — it was comparing 100
  against 80.
- **Every scenario** prints a `Corpus:` provenance line, and memory rows carry a
  ratio to the lowest-memory formatter.
- **`shared/utils.mjs`** carries the fork-owned preflight, scope, and provenance
  machinery; `preflight-selftest.mjs` (run first by `bench-all.mjs`) guards it.
- **Tooling**: `.node-version` pinned to 24, `@rsvelte/fmt` added, `vite-plus`
  pinned in the catalog (see the comment in `pnpm-workspace.yaml`).

## Layout

```
bench-formatter/
├── bench-all.mjs                    # run every scenario in sequence (`pnpm run bench`)
├── bench-all-and-update-readme.mjs  # run + scrape output into README (`pnpm run update-readme`)
├── init.sh                          # install deps, clone data repos, download parser.ts, build tsv
├── preflight-selftest.mjs           # verify preflight's matchers still read each tool's diagnostics
├── shared/utils.mjs                 # the harness: formatter commands + hyperfine + memory
├── bench-large-single-file/         # one scenario per dir (structure below)
├── bench-js-no-embedded/
├── bench-mixed-embedded/
├── bench-full-features/
├── bench-ts-only/                   # non-JSX scenario added by this fork (all 5 formatters incl. tsv)
├── bench-svelte/                    # Svelte scenario added by this fork (tsv vs rsvelte-fmt only)
├── vite.config.ts / pnpm-workspace.yaml  # vite-plus tooling + catalog
└── .github/workflows/               # ci.yml, security, update-readme
```

Each `bench-*/` scenario dir has an identical shape:

```
bench-<name>/
├── bench.mjs           # scenario entry: setupCwd → hyperfine runs → memory runs
├── biome.json          # biome config (sometimes empty when biome isn't run)
├── oxfmtrc.json        # oxfmt config
├── prettierrc.json     # prettier config
├── prettierrc-oxc.json # prettier config for the +oxc-parser variant (only where that variant is benched)
├── prettierignore      # prettier ignore (also used to scope which files are formatted)
└── data/               # test corpus — gitignored; cloned or downloaded by init.sh
```

`bench-svelte/` deviates from this shape: its only config is `oxfmtrc.json`
(rsvelte-fmt's; tsv takes none), plus `setup-corpus.mjs` (builds `data/`) and a
gitignored `repos/` clone cache — see "The rsvelte-fmt integration" below.

## The harness — `shared/utils.mjs`

- **`createFormatters(projectRoot, configDir)`** → `{ prettier, biome, oxfmt, tsv }`
  command builders. The npm binaries resolve at `<projectRoot>/node_modules/.bin/`;
  configs read from `configDir`. Each builder takes the file/dir args:
  - `prettier(files, cfg = "prettierrc.json")` → `… --write --config <dir>/<cfg> --ignore-path <dir>/prettierignore --ignore-unknown`
  - `biome(files)` → `biome format --write --files-ignore-unknown=true --config-path <dir> <files>`
  - `oxfmt(files)` → `oxfmt --config <dir>/oxfmtrc.json <files>`
  - `tsv(files)` → `<tsvBin> format <files>` — the **odd one out**: a native Rust
    binary, not an npm `.bin`. `tsvBin` is `TSV_BIN` or defaults to
    `<projectRoot>/../tsv/target/release/tsv`. No config file or flags (tsv is
    non-configurable); directory args recurse over `.ts`/`.svelte`/`.css` only.
  - `rsvelte(files)` → `… --config <dir>/oxfmtrc.json <files>` — the
    `@rsvelte/fmt` npm bin (a Node launcher that execs a platform-native binary
    and points it at the project's oxfmt for non-`.svelte` files). Configurable,
    unlike tsv; only `bench-svelte` uses it.
  - Note in the source: do **not** pass prettier `--experimental-cli` (it
    behaves differently from the stable CLI).
- **`runHyperfine(args)`** — spawns `hyperfine` (stdio inherited), resolves on exit 0.
- **`runMemoryBenchmarks(benchmarks, runs)`** / `measureMemory` — runs each
  command under GNU `time -f '%M'` (peak RSS in KB → MB). Auto-detects `gtime`
  then `/usr/bin/time`; `checkGnuTime()` warns and skips memory if neither.
- **`printHeader`**, **`FORMATTER_NAMES`** — display helpers.
- **`setupCwd(import.meta.url)`** — each `bench.mjs` chdirs into its own dir so
  relative config/data paths resolve.
- **`benchRunCounts(warmup, runs)`** — a scenario's run counts, with
  `BENCH_WARMUP` / `BENCH_RUNS` overrides for smoke runs (see "Quick runs"
  below). Both are validated and a bad value exits with a one-line message:
  hyperfine _hangs_ on `--runs=0` and rejects `--runs=NaN`, so an unchecked typo
  would wedge the scenario or fail it long after the corpus was set up. Wired
  into the three tsv scenarios; the three tsv-free ones keep upstream's
  hard-coded constants.

## Scenarios

| Dir                       | Corpus                                                                             | Reset / prepare                                                    | warmup × runs | Formatters run           |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------- | ------------------------ |
| `bench-large-single-file` | TS compiler `parser.ts` (~540KB, v5.9.2)                                           | `cp parser.ts.bak parser.ts`                                       | 2 × 5         | all 5 (incl. tsv)        |
| `bench-js-no-embedded`    | [outline](https://github.com/outline/outline) (js/ts/jsx/tsx)                      | `git reset --hard`                                                 | 3 × 10        | all 4 (no tsv — JSX/TSX) |
| `bench-mixed-embedded`    | [storybook](https://github.com/storybookjs/storybook) (embedded langs)             | `git reset --hard` + rm stray prettier configs                     | 1 × 3         | prettier+oxc, oxfmt      |
| `bench-full-features`     | [continue](https://github.com/continuedev/continue) (sort-imports + tailwind)      | `git reset --hard` + strip a tailwind `require` + rm `.prettierrc` | 1 × 3         | prettier+oxc, oxfmt      |
| `bench-ts-only`           | [outline](https://github.com/outline/outline), non-JSX subset (`.ts`/`.js`/`.mjs`) | `git reset --hard` (its own outline checkout)                      | 2 × 5         | all 5 (incl. tsv)        |
| `bench-svelte`            | `.svelte` snapshot: kit + svelte.dev + 5 Svelte libs (see rsvelte-fmt section)     | `git reset --hard` (snapshot repo built by `setup-corpus.mjs`)     | 2 × 5         | tsv, rsvelte-fmt         |

**Quick runs**: the three tsv scenarios (`bench-large-single-file`,
`bench-ts-only`, `bench-svelte`) take `BENCH_WARMUP` / `BENCH_RUNS` overrides via
`benchRunCounts`, so a change to the harness can be smoke-tested in seconds
rather than minutes: `BENCH_WARMUP=0 BENCH_RUNS=1 node ./bench-ts-only/bench.mjs`.
Numbers from an override are not publishable, and don't pretend to be — every
scenario prints the counts it resolved in its header, so an override is visible
in a scraped README. The three tsv-free scenarios are upstream's files and keep
upstream's hard-coded constants, to hold the merge surface down.

The two embedded/full-features scenarios deliberately drop plain-prettier and
biome and bench only the prettier+oxc-parser vs oxfmt pair. File-type scoping is
done per formatter: `prettierignore` (allowlist via `!*.ext`), oxfmt
`ignorePatterns`, and biome `files.includes`. `bench-ts-only` uses the same
three-way scoping narrowed to the non-JSX JS/TS family (the common set every
formatter, including tsv, supports) so the comparison is apples-to-apples;
`bench-large-single-file` needs no scoping since its corpus is a single `.ts` file.

`bench-ts-only` clones outline a **second** time rather than sharing
`bench-js-no-embedded/data`, so each scenario resets its own tree. It benches the
same real-world repo minus the 682 `.tsx` files tsv cannot parse, which keeps the
corpus third-party: no formatter here is measured on code it already shaped.

**Methodology — preflight:** the three tsv-free upstream scenarios run hyperfine
with `--ignore-failure` (and the memory pass swallows command errors everywhere),
so a formatter that _errors_ partway is timed rather than penalized — one that
rejected much of the corpus could look artificially fast. The three tsv-inclusive
scenarios drop the flag, because preflight has already ruled out the corpus
reasons a formatter would exit non-zero: what's left is a real crash, and it must
fail the scenario rather than be timed as a fast partial run.
The three tsv-inclusive scenarios guard against this with
`runPreflight` (`shared/utils.mjs`), which runs each formatter's **check** command
first, parses per-file parse errors out of its diagnostics (one matcher per tool —
they share no error format), and reports what each rejects before any timing. It
also flags a check command that fails to launch (exit 126/127), crashes
(exit ≥ 128, the killed-by-signal encoding), has no matcher to read, or reports an
error it attributes to no file — each must read as "unknown coverage", never as
clean. That last one is the plugin-and-config case: prettier with an unresolvable
plugin, or any tool handed a path that matched nothing, exits non-zero having
formatted nothing, and would then be timed doing no work at all. Only prettier,
prettier+oxc-parser, and tsv are covered (`PREFLIGHT_ERROR_SIGNALS`) — biome calls
formatting diffs "errors" and oxfmt's failure text names no file, so neither has a
signal that couldn't fire on an ordinary run.

**Preflight also cross-checks scope**, from counts the same check output already
carries: every formatter that reports how many files it looked at (biome `Checked
N files`, oxfmt `Finished … on N files`, tsv `N would change, M unchanged`,
rsvelte-fmt `would reformat N / M files`) must report the **same** number, and
every formatter must find at least one file to change. The first turns "all three
self-report 1648" from a hand-verified footnote into a per-run assertion — the
three scoping mechanisms are unrelated, so they drift silently. The second catches
the emptiest failure: a `prettierignore` whose allowlist stops matching prints
"All matched files use Prettier code style!", exits 0, and the timed run that
follows measures process startup. prettier reports no file count (its per-file
`[warn]` lines give the would-change count instead), so it sits out the parity
comparison but not the no-op check. The numbers ride on each preflight line after
the status word, where the README consumer's parser ignores them.

Each scenario now runs its `--prepare` command **before** preflight, not just
between timed runs: the parse check and those counts have to describe the corpus
that gets benchmarked, not whatever the previous run left formatted. (Without it,
a second run in a row sees a corpus the last formatter already rewrote and trips
the no-op check.)

**Any of those aborts the scenario** (`runPreflight` throws; `bench-all.mjs` logs
it and moves to the next scenario). It deliberately does _not_ filter the rejected
files out and carry on: the formatters are scoped by three separate mechanisms
(`prettierignore`, oxfmt `ignorePatterns`, biome `files.includes`), so narrowing
mid-run would mean generating per-run configs and publishing numbers for a corpus
that no longer matches its own description. A corpus one formatter can't take is a
corpus to fix, not to quietly shrink. Consequence worth knowing: on a machine
without the tsv binary (CI), the two tsv scenarios and `bench-svelte` abort
whole rather than losing just the tsv row.

If the no-op check ever fires legitimately — a corpus that genuinely is already in
some formatter's style — the fix is a different corpus, not a relaxed check: benching
a formatter against its own output measures its no-op path, which is not what any of
these numbers claim to be.

The asymmetry preflight watches for is real: tsv has no JSX parser, so JSX inside a
`.js` file is a parse error for tsv and ordinary input for prettier, biome, and
oxfmt. Outline's non-JSX subset is currently clean for all five, so nothing has
ever aborted — it is a guard, not an active filter. The three tsv-free scenarios
have no preflight; every formatter there is a JS-native tool that accepts the whole
corpus, and a check pass over storybook/continue would cost minutes for no signal.

**Matchers are the guard's weak point**, and `preflight-selftest.mjs` is what
guards them: they read tool-specific diagnostic text, so a formatter that changes
its error format goes quiet rather than loud — preflight reports every corpus clean
and nothing about the run looks wrong. The self-test generates fixtures into a temp
directory (nothing broken is committed, so `vp check` never sees them) and drives
the real `runPreflight` over each formatter three ways: a file it must reject, a
valid-but-unformatted file containing `key: value` text it must accept, and — for
the tools with an error signal — a path that doesn't exist, which must not read as
clean. A missing binary is a skip with a notice, not a failure, so CI verifies the
matchers it can reach. `bench-all.mjs` runs it before any scenario and treats
failure as fatal; run it alone with `pnpm run preflight-selftest` after upgrading a
formatter. Its output sits above the first `Benchmarking` banner, so the README
scrape never picks it up.

Two design details it locks in. Matchers whose prefix isn't already unique to a
diagnostic line anchor their capture on a source-file extension — prettier echoes
the offending source lines under the same `[error] ` prefix, so an unanchored
capture reads `[error]   1 | const o = { a: 1 }` as a rejected file. And an
unrecognized formatter name aborts rather than reporting clean.

A fixture note worth keeping: JSX in a `.ts` file is **not** a universal parse
error. prettier's default parser, biome, oxfmt, and tsv all reject it, but
`@prettier/plugin-oxc` parses it and calls the file already formatted — so the
self-test uses a plain syntax error instead.

**Run order is fixed, and tsv runs last.** hyperfine executes the `-n` commands in
the order given and doesn't interleave or randomize them, so on a laptop that
thermally throttles, later formatters run on a warmer machine. In the tsv
scenarios tsv is the last command, which biases against it rather than for it —
worth knowing before quoting a ratio to two decimal places, and worth re-checking
if the order is ever changed.

**Concurrency, when reading the numbers:** the harness never caps threads, so
each formatter runs at its own default — tsv, oxfmt, biome, and rsvelte-fmt
parallelize across files; prettier is effectively single-threaded. So on the multi-file scenarios
the wall-clock comparison bakes in each tool's own parallelism (a User-time far
above wall-time is the tell for the parallel ones), which is the intended
real-world measure. **No thread flags are passed, deliberately**: oxfmt has
`--threads` and tsv has `--jobs`, but biome has no equivalent, so a pinned
comparison could not cover every formatter — and pinning would stop measuring what
this suite is for. Consequence to keep in mind: a ratio between a parallel tool and
a serial one **scales with core count**, so a ratio is only meaningful alongside
the machine (`update-readme` records it under `## Versions`; see the README's
"How to read these numbers").

Separating engine from thread count: comparing hyperfine's `[User: …]` times
instead of wall times is the parallelism-neutral view — on `bench-ts-only` tsv is
~3x oxfmt in wall-clock but ~2x in CPU work, the rest being cores oxfmt left idle.
**But User time is only a clean engine proxy while threads do real work.**
`bench-large-single-file` is _not_ the controlled single-thread exception it looks
like: with one file to format, tsv clamps its worker count to the file count (User
< wall, genuinely one thread) and biome likewise stays single-threaded, but **oxfmt
still spins up a pool it cannot use** — it reports ~455ms User against ~235ms wall.
That overhead inflates its User time without being formatting work, so neither the
wall nor the CPU-work comparison in that scenario is engine-vs-engine.

**Every formatter tsv competes against is pinned to tsv's style.** tsv is
non-configurable — width 100, tabs, single quotes, no trailing commas — and it
cannot be aligned down to a rival's defaults, so the rivals are aligned up to it.
The three scenarios tsv runs in (`bench-large-single-file`, `bench-ts-only`,
`bench-svelte`) set that same profile for prettier, prettier+oxc-parser, biome,
oxfmt, and rsvelte-fmt, in each tool's own dialect: prettier/oxfmt take
`printWidth` + `useTabs` + `singleQuote` + `trailingComma`, biome takes
`formatter.lineWidth` + `indentStyle` and `javascript.formatter.quoteStyle` +
`trailingCommas`.

The alternative — leaving each tool on its defaults (width 80) while tsv formats at
100 — meant they were making different break decisions and rewriting different
amounts of the corpus, which shows up directly in the preflight counts: on
`bench-ts-only` the width-80 tools reported 1564 files to change against tsv's
1644, and pinning the profile brought all five to the same 1644. Equal work is
worth more here than each tool's default, and the cost is that these rows aren't
comparable with upstream's published numbers.

The three tsv-free scenarios keep upstream's settings, except that
`bench-full-features` now sets oxfmt's `printWidth` to 100 to match the prettier
width upstream already chose there — that scenario was comparing prettier at 100
against oxfmt at 80. It changes little in practice (oxfmt rewrites 2082 files
either way; the sort-imports and tailwind transforms dominate), but the comparison
is no longer lopsided by construction.

## Running

```bash
pnpm install                  # or ./init.sh (also fetches corpora)
pnpm run bench                # all scenarios; auto-runs ./init.sh if data missing
pnpm run update-readme        # run + rewrite README results/versions sections
node ./bench-js-no-embedded/bench.mjs   # one scenario directly
```

External tools required: **hyperfine** (`apt install hyperfine`) and **GNU
time** (`apt install time` → `/usr/bin/time`; macOS `brew install gnu-time` →
`gtime`). Without GNU time the timing benchmarks still run; only memory is
skipped.

`update-readme` rebuilds tsv, scrapes stdout from `vp run bench`, replaces the
block between `<!-- BENCHMARK_RESULTS_START -->` / `<!-- BENCHMARK_RESULTS_END -->`
in `README.md`, and refreshes the `## Versions` section. The
prettier/biome/oxfmt/rsvelte-fmt versions come from `vp exec <bin> --version`;
tsv's from `$TSV_BIN --version` — it's a native binary, so `vp exec` can't reach
it, and asking the binary rather than `../tsv/Cargo.toml` means the published
version names the build that was actually measured. CI
(`.github/workflows/ci.yml`) runs `vp run bench` on push/PR as a smoke test.

**The rebuild is the publish path's job because nothing else does it.**
`bench-all.mjs` runs `init.sh` only when a corpus is missing, and `init.sh` builds
tsv only when the binary is _absent_ — it never refreshes a stale one, deliberately,
so a pinned copy isn't overwritten. Fine while iterating; on the publish path it
meant benching last week's build under this week's version string. So
`update-readme` runs `cargo build --release -p tsv_cli --manifest-path
../tsv/Cargo.toml` first (a no-op when current), skips that when `TSV_BIN` is set
explicitly (pinning a fixed binary is what that path is for), and in either case
aborts up front if the resolved binary isn't executable — rather than letting the
three tsv scenarios abort one at a time and drop out of the README unremarked.

**Heads-up — regenerate the README locally, on one machine.** `update-readme.yml`
is **`workflow_dispatch` only**; it deliberately does _not_ auto-refresh the README
on a `pnpm-lock.yaml` bump. Two reasons, both of which corrupt the results:

- **CI has no tsv.** Neither workflow builds it, so preflight finds the binary
  unavailable and `bench-large-single-file`, `bench-ts-only`, and `bench-svelte`
  abort whole — the README loses those three scenarios entirely, not just their tsv
  rows (per-scenario errors are non-fatal, so the run still "succeeds"). CI also has
  no `../kit`/`../svelte.dev` sibling checkouts, so the `bench-svelte` corpus can't
  build there either. Nothing blocks teaching CI to build tsv now —
  `github.com/fuzdev/tsv` is public and the corpus no longer needs the private fuz
  repos — it just isn't wired up. Until it is, `update-readme.yml` **fails** rather
  than opening that PR: the script aborts up front on a missing tsv binary.
- **Core count changes the answer.** biome, oxfmt, and tsv scale with cores while
  prettier is effectively serial, so a runner's ratios and a dev box's ratios are
  different numbers, not noisy versions of the same one. A README mixing rows from
  both is not internally comparable.

So regenerate with `pnpm run update-readme` **locally**, where `../tsv` exists, and
keep every row from one machine.

**Merging upstream conflicts the README every time upstream reruns.** Take _this
fork's_ block wholesale — upstream's numbers come from their machine and carry no
tsv or `bench-svelte` rows, so a hunk-by-hunk merge produces a README whose rows
are not comparable to each other. Then rerun `update-readme` locally if the merge
moved a benched formatter's version. `package.json` conflicts are usually the same
shape: union this fork's added dep with upstream's bump.

**The README results block is a consumed interface.**
[tsv.fuz.dev](https://tsv.fuz.dev/docs/benchmarks) renders these numbers on its
benchmarks page, and since this suite publishes no JSON, its generator parses the
README: the `<!-- BENCHMARK_RESULTS_START -->` / `END` markers, the
`=====`-banner scenario headings, hyperfine's `Benchmark N:` / `Time (mean ± σ)` /
`Range (min … max)` / `Summary` lines, the `Memory Usage:` rows, the preflight
block, the `## Versions` list, and the `_Measured on: …_` line. Changing any of
those shapes — or dropping a marker — fails that site's `gro gen` with a message
naming the scenario and section that stopped parsing (a rename that still parses
trips its tests instead). It fails loudly rather than quietly publishing stale
numbers, but it does fail: pair a format change with a fix there.

## Adding a formatter or scenario

- **New scenario**: create `bench-<name>/` (copy an existing one), add the dir
  name to the `scenarios` array in `bench-all.mjs`, and add any corpus fetch to
  `init.sh`.
- **New formatter**: add a command builder to `createFormatters` in
  `shared/utils.mjs`, then add a `-n=<name>` arg + command to each scenario's
  `runHyperfine([...])` call and a matching entry in its `runMemoryBenchmarks`
  list. If it's a native binary rather than an npm `.bin` (as tsv is), resolve
  it via an env-var override with a sibling-checkout default, teach `init.sh` to
  build/locate it, and source its version from the binary itself (not
  `vp exec … --version`, which only reaches npm bins) in
  `bench-all-and-update-readme.mjs`.
- **A formatter in a preflight scenario needs three more entries**, all in
  `shared/utils.mjs`, keyed by the same display name the scenario passes:
  a `check.<name>` builder (same scope and config, no writes), a
  `PREFLIGHT_MATCHERS` pattern pulling rejected paths out of its diagnostics, and
  `PREFLIGHT_SCOPE_COUNTS` patterns for how many files it looked at and how many
  it would change. Optionally a `PREFLIGHT_ERROR_SIGNALS` pattern, if it has an
  error prefix that can't appear on an ordinary check run. Miss any of the
  required ones and the scenario aborts rather than passing by default — a
  formatter with no matcher, or no would-change count, reads as unverified, not
  as clean. Add its case to `preflight-selftest.mjs` in the same commit; that is
  what keeps the patterns honest as the tool's output drifts.
- **A formatter benched against tsv** is pinned to tsv's fixed style (width 100,
  tabs, single quotes, no trailing commas) in that scenario's config, in whatever
  dialect the tool speaks.

## The tsv integration

[`tsv`](https://github.com/fuzdev/tsv) (`~/dev/tsv`) is wired in as a fifth
formatter — the defining difference between this fork and upstream. Where it
lives:

- **Binary**: `tsv` from the `tsv_cli` crate — `cargo build -p tsv_cli
--release` → `target/release/tsv`. It's a native Rust binary, not an npm
  `.bin`, so `createFormatters` resolves it via `TSV_BIN` (default
  `<projectRoot>/../tsv/target/release/tsv`) rather than `node_modules/.bin`.
  `init.sh` builds it if missing and `../tsv` is present (full setup, including
  the copy-in path, under "Setting up the tsv binary" below).
- **In-place, non-configurable**: `tsv format <paths>` writes only when output
  differs and takes no config file or flags — it slots straight into the
  reset-then-format-then-measure loop.
- **Parallelism**: `tsv format` is multi-file parallel — a pool of worker threads
  (default = `std::thread::available_parallelism()`, i.e. the logical core count)
  pulling the next file from a shared atomic counter over the sorted file list
  (std threads, dynamic load-balancing, no rayon). The bench passes no `--jobs`,
  so tsv uses all cores — the same posture as oxfmt and biome. The worker count
  is clamped to the file count, so a single-file input runs on one thread: in
  `bench-large-single-file` tsv (like every tool) is effectively single-threaded,
  and only the multi-file scenarios exercise its parallelism.
- **No JSX/TSX**: tsv's parsers are `typescript | svelte | css`, where the
  TypeScript parser covers the whole JS family (`.js`/`.mjs`/`.cjs` format as
  TypeScript, a syntactic superset). What it has no parser for is JSX, so it runs
  only where the corpus is JSX-free: `bench-large-single-file` (single `.ts` file,
  ideal as-is), `bench-ts-only` (outline minus its 682 `.tsx` files), and
  `bench-svelte` (a `.svelte`-only snapshot). In those
  scenarios every _other_ formatter is scoped to the same non-JSX subset so the
  head-to-head is apples-to-apples. The three embedded/JSX scenarios are left
  tsv-free. Note the asymmetry preflight exists to catch: JSX inside a `.js` file
  is a **parse error** for tsv (exit 2) but ordinary input for prettier, biome, and
  oxfmt — all three format it happily.
- **Directory discovery** (a `tsv format <dir>` arg, as the scenarios use): tsv
  recurses over the JS/TS family (`.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs`),
  `.svelte`, and `.css`, and is gitignore-aware — inside a git repo it honors
  `.gitignore` (hierarchically) plus a repo-root `.formatignore` /
  `.prettierignore`, always pruning `.git`/`node_modules`; outside a repo it
  applies a build-output heuristic (`dist`/`build`/`target` + hidden dirs) and
  warns that a `.prettierignore` won't be read. Because tsv self-scopes by
  extension while the other three are scoped by config, **the corpus decides
  whether they agree** — on outline, tsv discovers exactly 1648 files
  (1339 `.ts` + 308 `.js` + 1 `.mjs`) and biome and oxfmt each self-report the same 1648. Preflight now asserts that agreement on every run rather than leaving it to
  a periodic hand-check, and `assertScopeConfigsAgree` checks the three scoping
  files name the same extensions before the corpus is even read. It holds _because_ outline has no `.svelte`/`.css` (which tsv would grab
  and the JS/TS-scoped configs would skip) and no in-corpus `.prettierignore`
  (which tsv would honor and the others would not, since they're pointed at the
  scenario's own ignore file) — if either changes, the scenario aborts instead of
  publishing a lopsided comparison. (Note: tsv
  formats `.d.ts` — the extension is `.ts` — and outline's 15 are in scope for
  everyone via `!*.ts`.) `tsv format <dir> --list` prints the in-scope set without
  writing — the read-only way to confirm scope.
- **Why the corpus must stay a git repo (subtle, load-bearing):** the outer
  bench-formatter repo's `.gitignore` ignores `bench-*/data/`. `bench-ts-only`
  only discovers anything because `data/` is itself a git repo (the `git clone`
  brings its own `.git`) — that makes `data/` tsv's format root, so the outer
  `.gitignore` sits above the root and is never read. Hand it a corpus with no
  `.git` and tsv's format root becomes the bench-formatter repo, which _does_
  ignore `bench-*/data/`, so discovery returns **zero** files. Any future
  copied/generated corpus must therefore `git init` (the old harvested `.ts`
  snapshot did exactly that). `bench-large-single-file` sidesteps the same trap
  differently:
  it passes the file (`./data/parser.ts`) explicitly, and an explicit file arg
  bypasses the ignore files — a `tsv format ./data` _directory_ arg there would
  be pruned by the outer `.gitignore`. Both confirmed via `--list`.
- **Version**: `tsv --version`, asked of the binary by
  `bench-all-and-update-readme.mjs` — which also rebuilds it first (see Running,
  above).

### Setting up the tsv binary

The harness resolves tsv from `TSV_BIN`, falling back to
`../tsv/target/release/tsv`. Two ways to get a usable binary in place:

- **Sibling checkout (default — `init.sh` automates it):** keep the tsv repo at
  `~/dev/tsv`. `init.sh` (run directly, or by `pnpm run bench` when data is
  missing) builds it when the resolved path isn't executable:

  ```bash
  cargo build --release -p tsv_cli --manifest-path ../tsv/Cargo.toml
  ```

  No copying — the default `TSV_BIN` points straight at the sibling's `target/`.

- **Copy a prebuilt binary in (when `../tsv` isn't a sibling, or to pin a fixed
  build):** build it once in the tsv repo, copy the binary somewhere stable, and
  point the harness at it via `TSV_BIN`:

  ```bash
  # in the tsv repo
  cargo build --release -p tsv_cli          # → target/release/tsv
  cp target/release/tsv /some/stable/path/tsv

  # then run the bench against the copy
  TSV_BIN=/some/stable/path/tsv pnpm run bench
  ```

  `init.sh` treats an executable `$TSV_BIN` as already-present — it won't rebuild
  or overwrite it — so the copy is used as-is. It's an ordinary dynamically-linked
  Rust binary: fine to move within the same OS/arch, not a portable static build.
  `update-readme` treats it the same way — it won't rebuild or overwrite an
  explicit `TSV_BIN` — and reads the version from the binary, so this path names
  its real version with no sibling `../tsv` present. One wrinkle: the
  `(binary built …)` suffix on that version line is the file's mtime, which for a
  copied binary is when it was **copied**, not when it was built (`cp -p`
  preserves the build time).

### Future tsv work (planned, not yet done)

The current coverage is the JS/TS family plus Svelte (`bench-svelte`). tsv also
formats `.css`, and that parser is **not yet exercised** by any scenario.
Candidates:

- A CSS corpus so tsv's CSS parser gets benchmarked.
- tsv-scoped variants of the embedded scenarios (`bench-mixed-embedded`,
  `bench-full-features`) — i.e. narrowing those corpora to tsv's supported set
  rather than leaving tsv out of them entirely.
- Preflight for the three tsv-free scenarios. It only guards the three tsv-inclusive
  ones today; the `--ignore-failure` caveat applies everywhere, it just
  has no known bite where every formatter is a JS-native tool.
- Command-level error signals for biome and oxfmt. `PREFLIGHT_ERROR_SIGNALS` covers
  prettier and tsv; the other two have no error prefix that couldn't fire on an
  ordinary check run, so a failure that formats nothing still reads as clean there.
  A file-count assertion ("the tool reported looking at ≥ 1 files") would cover all
  of them, at the cost of another per-tool matcher to keep alive.
- **Pin the cloned corpora.** `init.sh` and both workflows clone
  outline/storybook/continue at their default-branch HEAD, unpinned, so the corpus
  drifts and a rerun months apart is not comparable — and outline is now cloned
  twice, which can land two different commits. `bench-large-single-file` already
  pins (`v5.9.2`); the clones should too. `bench-svelte`'s five library clones
  and two sibling checkouts are likewise unpinned, though its snapshot at least
  freezes the corpus between regenerations and records source commits in
  `data/`'s commit message. Until they are pinned, each scenario at least prints a
  `Corpus:` line (`describeCorpus`) naming the commit and date it ran against — or,
  for the single downloaded file, its size and content hash — so two runs can be
  told apart instead of silently differing.

When adding these, keep the apples-to-apples discipline: scope _every_ formatter
in a tsv-inclusive run to the same file set (the three-way `prettierignore` /
oxfmt `ignorePatterns` / biome `files.includes` scoping), and regenerate the
README Results afterward.

## The rsvelte-fmt integration (bench-svelte)

[`@rsvelte/fmt`](https://github.com/baseballyama/rsvelte) is the second
fork-added formatter: a Rust Svelte formatter (rsvelte parser; `oxc_formatter`
for `<script>`, `oxc_formatter_css` for `<style>`, both in-process) that runs
only in `bench-svelte`, head-to-head with tsv — the two Svelte-native
formatters, on `.svelte` files only.

- **Binary**: the `rsvelte-fmt` npm bin — a Node launcher that resolves the
  platform-native binary plus the project's oxfmt and execs it. Every timed run
  therefore includes one Node cold start, and the memory row measures the whole
  process tree (launcher + native binary + oxfmt leg) — its shipped CLI
  posture, same as measuring prettier's Node. On this `.svelte`-only corpus the
  oxfmt delegation leg spawns on zero files (and prints a "No config found"
  notice — the directory hand-off doesn't forward `--config`); that overhead is
  part of how `rsvelte-fmt <dir>` ships, so it deliberately stays.
- **Config parity**: rsvelte-fmt is configurable where tsv is not, so
  `bench-svelte/oxfmtrc.json` pins it to tsv's fixed style — `printWidth: 100`,
  `useTabs`, `singleQuote`, `trailingComma: "none"` — making break decisions
  and output volume comparable. This scenario set the precedent the other two
  tsv-inclusive ones now follow (see the style-parity note above).
- **The corpus** (`setup-corpus.mjs`): a `.svelte`-only snapshot of seven
  third-party sources. Sibling checkouts `../kit` (`packages/kit/src`) and
  `../svelte.dev` (`apps/svelte.dev/src` + `packages/repl/src` +
  `packages/site-kit/src`) — the same trees tsv's own bench corpus uses
  (`../svelte` is absent on purpose: `packages/svelte/src` is the compiler,
  zero `.svelte` files). Plus shallow clones, cached in the gitignored
  `bench-svelte/repos/`, of five Svelte libraries: layerchart, svelte-ux,
  flowbite-svelte, svelte-maplibre, layercake. Fixture pruning mirrors tsv's
  perf-view corpus rules (`fixtures` segments anywhere, `samples` under a
  `test` segment, hidden dirs). ~2,230 files / ~4.1MB, all third-party and
  prettier-shaped — neither benched formatter is measured on code it already
  shaped, and both would rewrite ~92% of the files, so write volume is
  symmetric too.
- **Why a snapshot, and why `git init`**: the two tools discover files
  differently (tsv is config-free and gitignore-aware; rsvelte-fmt walks
  `.svelte` itself and hands the rest of a directory to oxfmt, which would pick
  up `.json`/`.md`/etc), so a tree containing only the corpus files is the one
  way to pin both to the same set — both self-report 2230, which preflight now
  asserts every run. The
  `git init` makes `data/` its own git root (sidestepping the outer
  `.gitignore` trap described above) and provides the reset-per-run baseline;
  provenance (per-source commit + file count) is recorded in the snapshot's
  commit message. Regenerate with
  `rm -rf bench-svelte/data && node ./bench-svelte/setup-corpus.mjs`.
- **No `--ignore-failure`** (alone among the scenarios): both formatters exit 0
  on a successful write run, so any non-zero exit here is a real error — and
  rsvelte-fmt has a nondeterministic SIGABRT — seen in 0.7.4 and still in 0.7.11,
  in check mode as well as write mode, and not rare: it hit roughly one run in
  four over this corpus during one sitting (its launcher
  propagates signal deaths as exit 128+n, e.g. 134), which must abort the
  benchmark rather than be timed as a fast partial run. `runPreflight` flags
  crashed check passes the same way — so expect this scenario to abort
  occasionally and need a rerun, which is the honest outcome while the crash is
  real: a retry inside the harness would hide a defect in a tool whose numbers
  this README publishes. **Check for it after `update-readme`:** an aborted
  scenario writes its banner and preflight into the README with no timings under
  it, and tsv.fuz.dev's generator refuses a scenario it can't parse timings from.
  Rerun before committing rather than shipping a half-scenario.
- **Quick runs**: `BENCH_WARMUP=0 BENCH_RUNS=1 node ./bench-svelte/bench.mjs`
  overrides the 2 × 5 defaults for a fast, low-accuracy smoke run — see "Quick
  runs" under Scenarios for the other two scenarios that take it.
- **Version**: `vp exec rsvelte-fmt --version` in
  `bench-all-and-update-readme.mjs` (an npm bin, so `vp exec` reaches it where it
  can't reach tsv's native binary).
