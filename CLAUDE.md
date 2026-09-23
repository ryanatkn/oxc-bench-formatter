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
  `bench-large-single-file`, `bench-svelte`, `bench-tsv-delivery`). This is the
  fork's addition over upstream.
- **rsvelte-fmt** (`rsvelte-fmt`) — `@rsvelte/fmt`, Rust Svelte formatter that
  formats `.svelte` in-process and delegates other files to oxfmt; runs only in
  `bench-svelte`, head-to-head with tsv. Also fork-added.
- **tsv-npm** (`@fuzdev/tsv`'s `tsv` bin) — the same native binary reached
  through the package's Node dispatcher, the way `npx tsv` and most npm installs
  run it. Runs beside native tsv in every scenario tsv appears in: in
  `bench-ts-only`, `bench-large-single-file` and `bench-svelte` it is tsv on the
  same footing as the other tools' Node bins, in `bench-tsv-delivery` one of the
  three distributions. Also fork-added.
- **tsv-wasm** (`@fuzdev/tsv-wasm`) — tsv's CLI contract, mirrored in JS, over a
  WASM engine in Node; the distribution anyone on a platform without a prebuilt
  native binary falls back to. Runs only in `bench-tsv-delivery`, against native
  tsv. Also fork-added.

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
runs `vp staged`. Package manager is pnpm 11 (pinned by `packageManager`); Node is pinned to `24`.

## Deviations from upstream

What a merge from `oxc-project/bench-formatter` has to reconcile. Everything else
is upstream's, untouched.

- **Three formatters added**: tsv (the native binary from `@fuzdev/tsv`'s
  platform package, or `TSV_BIN`), rsvelte-fmt, and tsv-wasm — plus a tsv-npm
  row that is tsv again through its Node dispatcher.
- **Three scenarios added**: `bench-ts-only`, `bench-svelte`,
  `bench-tsv-delivery` — plus their entries in `bench-all.mjs` and `init.sh`.
- **`bench-large-single-file`** (upstream's) gained a tsv row and a tsv-npm row,
  a preflight pass, tsv's style profile on the other four formatters, the settle
  between commands the other tsv scenarios take, and lost
  `--ignore-failure`
  because preflight makes it redundant.
- **`bench-full-features`** (upstream's): oxfmt's `printWidth` raised to 100 to
  match the prettier width upstream already set there — it was comparing 100
  against 80.
- **Every scenario** prints and records a `Corpus:` provenance line, and memory rows carry a
  ratio to a fixed per-scenario baseline (tsv where it runs, oxfmt in upstream's
  three) rather than to whichever tool used least memory that run.
- **`shared/utils.mjs`** carries the fork-owned preflight, scope, and provenance
  machinery; `preflight-selftest.mjs` (run first by `bench-all.mjs`) guards it.
- **Results are also published as data**: `shared/utils.mjs` records each
  scenario as it prints it, and `update-readme` composes the records into
  `results.json` beside the README, along with the machine, the versions, and the
  Node launch floor (`node_startup`). The two lines every scenario changed for it,
  upstream's three included, are its `Target:` and `Corpus:` lines, now
  `printTarget(…)` / `printCorpus(…)`.
- **Setup is never auto-run**: upstream's `bench-all.mjs` shells out to
  `./init.sh` when a corpus is missing; here it stops with `assertBenchReady`, so
  the one networked step stays outside the benchmark (see Running). `package.json`
  gained a `setup` script and both workflows an explicit `./init.sh` step.
- **Tooling**: `.node-version` pinned to 24, `@rsvelte/fmt`, `@fuzdev/tsv` and
  `@fuzdev/tsv-wasm` added (with `@fuzdev/*` excluded from pnpm's release-age
  wait), and a root `.formatignore` that re-includes the two
  single-file corpora for tsv (see "Why the corpus must stay a git repo").

## Layout

```
bench-formatter/
├── bench-all.mjs                    # run every scenario in sequence (`pnpm run bench`)
├── bench-all-and-update-readme.mjs  # run + scrape output into README, compose results.json (`pnpm run update-readme`)
├── results.json                     # the last published run as data — what tsv.fuz.dev reads
├── results/                         # per-scenario records of the last run — gitignored
├── init.sh                          # the one networked step: install deps, clone data repos, download parser.ts, check the tsv binary resolves
├── preflight-selftest.mjs           # verify preflight's matchers still read each tool's diagnostics
├── shared/utils.mjs                 # the harness: formatter commands + hyperfine + memory
├── bench-large-single-file/         # one scenario per dir (structure below)
├── bench-js-no-embedded/
├── bench-mixed-embedded/
├── bench-full-features/
├── bench-ts-only/                   # non-JSX scenario added by this fork (all 5 formatters incl. tsv, plus tsv-npm)
├── bench-svelte/                    # Svelte scenario added by this fork (tsv + tsv-npm vs rsvelte-fmt only)
├── bench-tsv-delivery/              # what each tsv distribution costs (native vs WASM), fork-added
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
(rsvelte-fmt's; tsv takes none), plus `corpora-pin.mjs` (the one place its corpus
is pinned) and `setup-corpus.mjs` (builds `data/` from the fuzdev/corpora snapshot
at that pin, out of a sibling `../corpora` checkout or a gitignored `corpora/`
fetch cache) — see "The rsvelte-fmt integration" below.
`bench-tsv-delivery/` deviates further: `bench.mjs` and `data/`, no configs at
all, since all of its rows are tsv and tsv is non-configurable.

## The harness — `shared/utils.mjs`

- **`createFormatters(projectRoot, configDir)`** → `{ prettier, biome, oxfmt, tsv }`
  command builders. The npm binaries resolve at `<projectRoot>/node_modules/.bin/`;
  configs read from `configDir`. Each builder takes the file/dir args:
  - `prettier(files, cfg = "prettierrc.json")` → `… --write --config <dir>/<cfg> --ignore-path <dir>/prettierignore --ignore-unknown`
  - `biome(files)` → `biome format --write --files-ignore-unknown=true --config-path <dir> <files>`
  - `oxfmt(files)` → `oxfmt --config <dir>/oxfmtrc.json <files>`
  - `tsv(files)` → `<tsvBin> format <files>` — the **odd one out**: a native Rust
    binary, not an npm `.bin`. `tsvBin` comes from `resolveTsv`: `TSV_BIN` if set,
    else the `tsv` binary inside the `@fuzdev/tsv-<triple>` platform package that
    `@fuzdev/tsv` installed for this machine (resolved from that package's real
    location, since pnpm doesn't hoist it). No config file or flags (tsv is
    non-configurable); directory args recurse over `.ts`/`.svelte`/`.css` only.
  - `"tsv-npm"(files)` → `<projectRoot>/node_modules/.bin/bench-tsv-npm format <files>`
    — the same binary through its Node dispatcher (`@fuzdev/tsv/bin.js`); runs
    wherever native tsv does. `"tsv-wasm"` is the same shape over
    `.bin/bench-tsv-wasm`. Both bins are shims the harness derives from pnpm's
    own — `resolveTsvNodeBin`, see "The tsv-npm row".
  - `rsvelte(files)` → `… --config <dir>/oxfmtrc.json <files>` — the
    `@rsvelte/fmt` npm bin (a Node launcher that execs a platform-native binary
    and points it at the project's oxfmt for non-`.svelte` files). Configurable,
    unlike tsv; only `bench-svelte` uses it.
  - Note in the source: do **not** pass prettier `--experimental-cli` (it
    behaves differently from the stable CLI).
- **`runHyperfine(args)`** — spawns `hyperfine` (stdio inherited), resolves on exit 0.
- **`runMemoryBenchmarks(benchmarks, runs, {baseline, failOnCrash})`** /
  `measureMemory` — runs each command under GNU `time -f '%M'` (peak RSS in
  KB → MB). That figure is the **largest single process** in the command's tree,
  not the tree's sum (`ru_maxrss` takes a max over waited-for children): a
  launcher and the native binary it spawns are never added together. So biome's
  and rsvelte-fmt's rows are their native binary's peak without the ~45 MB Node
  launcher in front of it, tsv-npm's row is the Node dispatcher's own peak with
  tsv's hidden under it, and the single-process tools (prettier, oxfmt, tsv,
  tsv-wasm) are whole. It understates the launcher-style tools, never the others. Auto-detects `gtime` then `/usr/bin/time`; `checkGnuTime()` warns
  and skips memory if neither. `baseline` (required) names the row every ratio
  is taken against — tsv in the tsv scenarios, oxfmt in upstream's — so the
  column doesn't re-anchor on whichever tool used least that run; a ratio below
  1 means less than the baseline. A run the command died from a signal in (GNU
  time exits 128+n) is not a measurement: with `failOnCrash` (the tsv scenarios)
  it aborts the scenario with an `→ aborting:` line and no table, the memory
  counterpart of timing without `--ignore-failure`; without it the run is
  excluded and a `→ … runs crashed` line under the rows says so. A formatter's
  own non-zero exit still counts, as `--ignore-failure` does in the timed pass.
- **`benchRows(rows, {projectRoot, warmup, runs, prepare, baseline})`** — one
  scenario's three passes (preflight → hyperfine → memory) from a single
  `[{name, command, check}]` list, so a row can't be added to one pass and missed
  in another. Carries the tsv-scenario rules in one place: no `--ignore-failure`,
  `failOnCrash` on the memory pass, native tsv listed last. The three fork-added
  scenarios use it; `bench-large-single-file` is upstream's file and keeps
  upstream's three parallel lists, to hold the merge surface down.
- **`resolveTsvNodeBin(projectRoot, row)`** / **`warnUnshimmedTsvRows`** — the
  pnpm-shaped bin shims for the tsv-npm and tsv-wasm rows, and the line a
  scenario prints when one couldn't be derived. See "The tsv-npm row".
- **`printCorpus(describeCorpus(path))`** — the `Corpus:` line and the call that
  records it. Takes the text, not the path, because `bench-svelte` composes its
  corpora pin with the snapshot's own commit.
- **`printHeader`** — display helper. (`FORMATTER_NAMES` beside it is upstream's
  and unused by anything, here or upstream; left in place rather than deleted for
  the merge surface.)
- **`printRunCounts()`** — the tsv scenarios' run-counts line, with the settle
  (`SETTLE_SECONDS`) when it is on, and the call that records all three. It takes
  no arguments: the counts come from `benchRunCounts`, so the printed line can't
  disagree with the record. Upstream's three print their own line and settle on
  nothing.
- **`setupCwd(import.meta.url)`** — each `bench.mjs` chdirs into its own dir so
  relative config/data paths resolve.
- **`assertBenchReady(projectRoot)`** / **`missingBenchSetup`** — the gate
  `bench-all.mjs` and `update-readme` open with (dependencies, the seven
  corpora, hyperfine), and the list behind it, which `init.sh` closes on too
  (see "Setup is separate on purpose" under Running).
- **`benchRunCounts(warmup, runs)`** — a scenario's run counts, with
  `BENCH_WARMUP` / `BENCH_RUNS` overrides for smoke runs (see "Quick runs"
  below). Both are validated and a bad value exits with a one-line message:
  hyperfine _hangs_ on `--runs=0` and rejects `--runs=NaN`, so an unchecked typo
  would wedge the scenario or fail it long after the corpus was set up. The
  resolved counts also seed the scenario's record, so one that preflight aborts
  before hyperfine runs still publishes the counts it printed rather than 0.
  Wired into the four tsv scenarios; the three tsv-free ones keep upstream's
  hard-coded constants (their records take the counts from hyperfine's argv).

## Scenarios

| Dir                       | Corpus                                                                         | Reset / prepare                                                    | warmup × runs | Formatters run             |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------- | -------------------------- |
| `bench-large-single-file` | TS compiler `parser.ts` (~540KB, v5.9.2)                                       | `cp parser.ts.bak parser.ts`                                       | 3 × 20        | all 5 (incl. tsv), tsv-npm |
| `bench-js-no-embedded`    | [outline](https://github.com/outline/outline) (js/ts/jsx/tsx)                  | `git reset --hard`                                                 | 3 × 10        | all 4 (no tsv — JSX/TSX)   |
| `bench-mixed-embedded`    | [storybook](https://github.com/storybookjs/storybook) (embedded langs)         | `git reset --hard` + rm stray prettier configs                     | 1 × 3         | prettier+oxc, oxfmt        |
| `bench-full-features`     | [continue](https://github.com/continuedev/continue) (sort-imports + tailwind)  | `git reset --hard` + strip a tailwind `require` + rm `.prettierrc` | 1 × 3         | prettier+oxc, oxfmt        |
| `bench-ts-only`           | [outline](https://github.com/outline/outline), non-JSX subset                  | `git reset --hard` (its own outline checkout)                      | 3 × 10        | all 5 (incl. tsv), tsv-npm |
| `bench-svelte`            | `.svelte` snapshot: kit + svelte.dev + 5 Svelte libs (see rsvelte-fmt section) | `git reset --hard` (snapshot repo built by `setup-corpus.mjs`)     | 3 × 10        | tsv, tsv-npm, rsvelte-fmt  |
| `bench-tsv-delivery`      | TS compiler `parser.ts` again (its own copy)                                   | `cp parser.ts.bak parser.ts`                                       | 3 × 20        | tsv, tsv-npm, tsv-wasm     |

**Quick runs**: the four tsv scenarios (`bench-large-single-file`,
`bench-ts-only`, `bench-svelte`, `bench-tsv-delivery`) take
`BENCH_WARMUP` / `BENCH_RUNS` overrides via
`benchRunCounts`, so a change to the harness can be smoke-tested in seconds
rather than minutes: `BENCH_WARMUP=0 BENCH_RUNS=1 BENCH_SETTLE_S=0 node
./bench-ts-only/bench.mjs`. Drop the settle along with the counts — it costs 10s
per command whatever the run count is, which on its own outlasts a smoke run.
Numbers from an override are not publishable, and don't pretend to be — every
settling scenario prints the counts and settle it resolved in its header and
records them, so an override is visible in a scraped README and in
`results.json`. The three tsv-free scenarios are upstream's files and keep
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
with `--ignore-failure` (and their memory pass tolerates a formatter's own
non-zero exit, excluding and reporting only runs killed by a signal, since a
process that died partway measured nothing), so a formatter that _errors_
partway is timed rather than penalized — one that
rejected much of the corpus could look artificially fast. The four tsv-inclusive
scenarios drop the flag, because preflight has already ruled out the corpus
reasons a formatter would exit non-zero: what's left is a real crash, and it must
fail the scenario rather than be timed as a fast partial run.
The four tsv-inclusive scenarios guard against this with
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
the status word; they are printed, not recorded in `results.json`.

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
where the tsv binary is missing (a platform `@fuzdev/tsv` ships no package for,
and no `TSV_BIN`), all four tsv scenarios abort whole rather than losing just
the tsv row.

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
if the order is ever changed. The tsv scenarios also pass hyperfine `--setup
"sleep 10"` (`SETTLE_SECONDS` in `shared/utils.mjs`; `BENCH_SETTLE_S` overrides,
`0` disables), an idle before each command's warmups so every row starts from a
cooler, more alike package — it narrows the drift, it doesn't remove the order.
It rides on the run-counts line and into the record (`printRunCounts`,
`settle_seconds`) for the same reason the counts do: a knob that moves the
numbers has to leave a mark on what the run publishes, or two runs taken at
different settings read alike. Upstream's three scenarios don't settle and
record no such key.

**rsvelte-fmt's cache and daemon are pinned off** (`RSVELTE_FMT_NO_CACHE=1
RSVELTE_FMT_NO_DAEMON=1`, `createFormatters`). Both serve only its delegated CSS
path (`--no-native-css`), which the harness never takes: on the default in-process
path a run writes nothing to `RSVELTE_FMT_CACHE_DIR` and no `~/.cache/rsvelte-fmt`
has ever appeared on the machine behind `results.json`, so the published rows
carried no warm state. The pins keep that true across releases.

**`node_startup` in `results.json`** is a bare `node -e ""` timed under hyperfine
with the scenarios' PATH (`measureNodeStartup` in `bench-all-and-update-readme.mjs`):
the launch floor every npm-bin row pays. It sits beside `machine` and `versions`,
never as a row, so a consumer ranging over "every other tool" can't fold it in.
The Node that produced it is named in `versions` alongside the formatters —
asked of the `node` on the scenarios' PATH, the one `measureNodeStartup` times
and every npm-bin row starts — since a version change moves the floor and the
five Node-launched rows above it without any formatter having changed.

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
"Reading the numbers").

Separating engine from thread count: comparing hyperfine's `[User: …]` times
instead of wall times is the parallelism-neutral view — on `bench-ts-only` the
wall-clock ratio between two parallel tools and their CPU-work ratio differ by
however many cores one of them left idle. **But User time is only a clean engine
proxy while threads do real work.** `bench-large-single-file` is _not_
automatically the controlled single-thread exception it looks like: with one file
to format, tsv clamps its worker count to the file count (User < wall, genuinely
one thread), but a tool that spins up a pool it cannot use reports User well
_above_ wall on that one file — overhead that inflates its User time without
being formatting work, so neither the wall nor the CPU-work comparison is
engine-vs-engine for it. Which tools do that changes between versions (oxfmt did
in an earlier release), so read the tell — User against wall, per row — off each
regenerated README rather than from memory.

**Every formatter tsv competes against is pinned to tsv's style.** tsv is
non-configurable — width 100, tabs, single quotes, no trailing commas — and it
cannot be aligned down to a rival's defaults, so the rivals are aligned up to it.
The three scenarios where tsv faces another formatter
(`bench-large-single-file`, `bench-ts-only`, `bench-svelte`) set that same
profile for prettier, prettier+oxc-parser, biome, oxfmt, and rsvelte-fmt, in each
tool's own dialect: prettier/oxfmt take `printWidth` + `useTabs` + `singleQuote` +
`trailingComma`, biome takes `formatter.lineWidth` + `indentStyle` and
`javascript.formatter.quoteStyle` + `trailingCommas`. `bench-tsv-delivery` needs
none of it — all of its rows are tsv, at tsv's one style by construction.

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
pnpm run setup                # ./init.sh — deps + corpora; the only networked step
pnpm run bench                # all scenarios
pnpm run update-readme        # run + rewrite README results/versions sections
node ./bench-js-no-embedded/bench.mjs   # one scenario directly

# offline — skip the package-manager wrapper (see the pnpm caveat below)
node bench-all.mjs
node bench-all-and-update-readme.mjs
```

**Setup is separate on purpose, and the network stops there.** `./init.sh` holds
every network access in the suite — `pnpm install`, the four clones/downloads,
and `setup-corpus.mjs`'s fallback fetch of the pinned corpora commit. Nothing
downstream reaches the network: the formatters are installed, the corpora are
local, and the version strings come from binaries and manifests already on disk.
So a run can be started with the machine disconnected, which is also one fewer
source of noise on a timed run. `bench-all.mjs` used to shell out to `init.sh`
whenever a corpus was missing; it now stops via `assertBenchReady`
(`shared/utils.mjs`), listing everything missing at once and naming `./init.sh`.
`update-readme` calls the same check up front, beside its tsv-binary
check, so an unprepared machine fails in the first second rather than minutes in.

`init.sh` closes on that same list (`missingBenchSetup`) rather than on its own
bookkeeping: none of its steps stop the script, so a clone that failed for want
of network would otherwise scroll past under a "Setup complete". With anything
missing it names it and exits non-zero — which is also what fails a CI setup step
instead of the bench step after it. The tsv binary is deliberately not on the
list: without one the four tsv scenarios abort, but upstream's three still run,
so `init.sh` warns and `update-readme` is the one that refuses. On success it
prints the `node …` forms of the run commands ahead of the `pnpm run` ones, for
the reason in the next paragraph.

**The `pnpm run` wrapper is the exception, and it's the launcher, not the suite.**
`package.json` carries upstream's `packageManager` pin, and pnpm's
`manage-package-manager-versions` resolves that exact version from the npm
registry on _every_ pnpm invocation inside this repo when the globally installed
pnpm doesn't match it. Offline that means `pnpm run bench` sits for over a minute
before falling back to its cached copy — having never reached `bench-all.mjs`, so
it looks like the benchmark hanging when nothing has started. The opt-outs don't
help (neither `--config.manage-package-manager-versions=false` nor an `.npmrc`
entry: the fetch is in pnpm's bootstrap, before config). Two ways around it, both
verified offline: match the pin with the globally installed pnpm, or skip the
wrapper — `node bench-all.mjs`, `node bench-all-and-update-readme.mjs`, and
`vp run …` all start instantly with no network.

Skipping the wrapper costs one thing a package-manager script gives for free:
`node_modules/.bin` on `PATH`. `bench-all.mjs` never needed it (it spawns `node`
on each scenario), but `bench-all-and-update-readme.mjs` shells out to `vp` five
times — `vp run bench` plus the four npm-bin version reads — and `vp` lives
nowhere else, so run directly it used to fail at the first one. It now prepends
that directory itself (`binEnv`), which makes the two invocations equivalent
rather than making the launcher part of the contract. It also chdirs to the repo
root first, since everything else it touches (`README.md`, `node_modules`,
`vp run bench`) is addressed relative to it.

External tools required: **hyperfine** (`apt install hyperfine`) and **GNU
time** (`apt install time` → `/usr/bin/time`; macOS `brew install gnu-time` →
`gtime`). Without GNU time the timing benchmarks still run; only memory is
skipped.

`update-readme` scrapes stdout from `vp run bench`, replaces the block between
`<!-- BENCHMARK_RESULTS_START -->` / `<!-- BENCHMARK_RESULTS_END -->` in
`README.md`, and refreshes the `## Versions` section. The block is written in
the shape `vp check --fix` leaves it in — blank lines around the fence,
hyperfine's single-space separator lines emptied — so a regenerated README
passes the format check as written and its diff is only numbers. The
prettier/biome/oxfmt/rsvelte-fmt versions come from `vp exec <bin> --version`;
tsv's from the resolved binary's `--version` — it's a native binary, so `vp exec`
can't reach it, and asking the binary means the published version names the
build that was actually measured. When that binary is the platform package's,
the version is cross-checked against the package's own and the run refuses to
publish a mismatch, and the README line names the package (`0.3.0
(@fuzdev/tsv-linux-x64-gnu)`); with `TSV_BIN` it names the binary's mtime
instead, since a local build's version string doesn't move between builds.
`results.json` keeps the bare version in `versions.tsv` and records the source
beside it, in `tsv_binary`.
tsv-wasm's comes from its installed `package.json`: an npm package, but one
whose bin can't be addressed by name (see the tsv-wasm section) and whose CLI
has no `--version`. CI (`.github/workflows/ci.yml`) runs `vp run bench` on
push/PR as a smoke test, tsv scenarios included.

**Nothing builds tsv any more.** The binary is `@fuzdev/tsv`'s platform package,
installed by `pnpm install` and pinned by the lockfile like every other
formatter; `init.sh` only confirms it resolves, and `update-readme` aborts up
front if it isn't executable — rather than publishing all four tsv scenarios aborted
for one missing binary. `TSV_BIN` benches a local
build as-is (see "Setting up the tsv binary").

**Heads-up — regenerate the README locally, on one machine.** `update-readme.yml`
is **`workflow_dispatch` only**; it deliberately does _not_ auto-refresh the README
on a `pnpm-lock.yaml` bump. Two reasons, both of which corrupt the results:

- **Core count changes the answer.** biome, oxfmt, and tsv scale with cores while
  prettier is effectively serial, so a runner's ratios and a dev box's ratios are
  different numbers, not noisy versions of the same one. A README mixing rows from
  both is not internally comparable.
- **CI can now run everything** — tsv installs from npm and the `bench-svelte`
  corpus fetches itself at its pin — so `update-readme.yml` no longer fails on a
  missing binary; it opens the PR **without auto-merging it**. A runner-generated
  README is comparable within itself, so review it as a whole swap, never as a
  refresh of a few rows.

So regenerate with `pnpm run update-readme` **locally**, and keep every row from
one machine.

**Merging upstream conflicts the README every time upstream reruns.** Take _this
fork's_ block wholesale — upstream's numbers come from their machine and carry no
tsv or `bench-svelte` rows, so a hunk-by-hunk merge produces a README whose rows
are not comparable to each other. Then rerun `update-readme` locally if the merge
moved a benched formatter's version. `package.json` conflicts are usually the same
shape: union this fork's added dep with upstream's bump.

**`results.json` is a consumed interface; the README block is for readers.**
[tsv.fuz.dev](https://tsv.fuz.dev/docs/benchmarks) renders these numbers on its
benchmarks page, and its generator reads `results.json`, which `update-readme`
writes beside the README from the same run: `timestamp` (when the run started),
`git_commit` / `git_dirty` (the harness revision that ran, read before the run;
dirty ignores `README.md` and `results.json`, a previous run's output),
`machine` as fields (`cpu_model`, `threads`, `os`, `arch` in `uname -m` naming,
as tsv's own bench reports write it — the site checks the two agree),
`node_startup`, `versions` keyed by formatter name plus the `node` the
Node-launched rows ran on (tsv's a bare version), `tsv_binary` (where the native
tsv rows' binary came from: the platform package, or a dated `TSV_BIN` build),
and one record per scenario in run order — `id` (the slug of the
banner title, which that site keys its per-scenario copy on), `name`, `target`,
`corpus` (the provenance line — which revision of the corpus these numbers came
from), `warmup_runs` / `benchmark_runs`, `settle_seconds` in the scenarios that settle,
the `preflight` rows, `timings` in
milliseconds from hyperfine's own `--export-json`, `fastest` and `speedups`
(hyperfine's `Summary`, recomputed from the same means since it isn't exported;
`fastest` is absent when nothing was timed),
the `memory` rows in megabytes (their ratios against the scenario's fixed memory
baseline, which is the one row carrying none — not necessarily `fastest`), and
`aborted` / `unshimmed` when they apply.
The records are made by the functions that print the same facts
(`printHeader`, `printTarget`, `printCorpus`, `printRunCounts`, `runPreflight`,
`runHyperfine`, `runMemoryBenchmarks`, `warnUnshimmedTsvRows`) and written on process exit, so
an aborted scenario is recorded too — preflight rows and its `aborted` reason,
no timings. That site validates the file against a strict schema: renaming,
adding or dropping a key fails its `gro gen` with the path that failed (a
renamed scenario title still validates and trips its tests instead). It fails
loudly rather than quietly publishing stale numbers, but it does fail: pair a
shape change with a fix there. `results/` holds the per-scenario records of the
last run (gitignored; `bench-all.mjs` empties it first so a composed report
can't mix two runs), and running one scenario directly rewrites only its own
record, never `results.json`.

## Adding a formatter or scenario

- **New scenario**: create `bench-<name>/` (copy an existing one), add the dir
  name to the `scenarios` array in `bench-all.mjs`, and add any corpus fetch to
  `init.sh`. Print its banner with `printHeader`, its corpus label with
  `printTarget`, and its provenance with `printCorpus(describeCorpus(…))` — those
  start and fill the scenario's record in `results.json`.
- **New formatter**: add a command builder to `createFormatters` in
  `shared/utils.mjs`, then add a `-n=<name>` arg + command to each scenario's
  `runHyperfine([...])` call and a matching entry in its `runMemoryBenchmarks`
  list. If it's a native binary rather than an npm `.bin` (as tsv is), resolve
  it from its platform package with an env-var override for local builds (see
  `resolveTsv`), and source its version from the binary itself (not
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
  what keeps the patterns honest as the tool's output drifts. A formatter that
  ships another one's CLI (tsv-wasm does) can _share_ the matcher and count
  entries rather than copy them — they're pulled out as named constants for
  exactly that — but it still needs its own self-test case: the two are built and
  published separately, so identical output is a claim to check, not a premise.
- **A formatter benched against tsv** is pinned to tsv's fixed style (width 100,
  tabs, single quotes, no trailing commas) in that scenario's config, in whatever
  dialect the tool speaks.

## The tsv integration

[`tsv`](https://github.com/fuzdev/tsv) (`~/dev/tsv`) is wired in as a fifth
formatter — the defining difference between this fork and upstream. Where it
lives:

- **Binary**: `tsv` from the `tsv_cli` crate, as shipped in the
  `@fuzdev/tsv-<triple>` platform package that `@fuzdev/tsv` pulls in for this
  machine — the same `cargo build --locked -p tsv_cli --release` (LTO, one
  codegen unit, abort, stripped) a local build makes, which an A/B against a
  build of the same tag confirmed within run-to-run noise. It's a native Rust
  binary, not an npm `.bin`, so `createFormatters` resolves it via `resolveTsv`
  (`TSV_BIN`, else the platform package) rather than `node_modules/.bin` (full
  detail, including the local-build path, under "Setting up the tsv binary"
  below).
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
  `.gitignore` plus `.formatignore` / `.prettierignore`, all three hierarchically
  (at any depth, not just the repo root), always pruning `.git`/`node_modules`;
  outside a repo it applies a build-output heuristic (`dist`/`build`/`target` +
  hidden dirs) and warns that a `.prettierignore` won't be read. Because tsv self-scopes by
  extension while the other three are scoped by config, **the corpus decides
  whether they agree** — on outline, tsv discovers exactly 1648 files
  (1339 `.ts` + 308 `.js` + 1 `.mjs`) and biome and oxfmt each self-report the same 1648. Preflight now asserts that agreement on every run rather than leaving it to
  a periodic hand-check, and `assertScopeConfigsAgree` checks the three scoping
  files name the same extensions before the corpus is even read. It holds _because_ outline has no `.svelte`/`.css` (which tsv would grab
  and the JS/TS-scoped configs would skip) and no in-corpus `.prettierignore` at
  any depth
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
  snapshot did exactly that). `bench-large-single-file` and `bench-tsv-delivery`
  sit in the same trap and are dug out differently: they pass the file
  (`./data/parser.ts`) explicitly, and **as of tsv 0.3 a named file is bounded
  by the ignore files too** — one they exclude is skipped with a warning and
  exit 0, not formatted (0.2 formatted a named file regardless). So the
  repo-root `.formatignore` re-includes exactly those two files, in the order
  tsv's own warning prescribes (un-ignore the directory, re-ignore its contents,
  un-ignore the file). Without it every tsv distribution reports `0 would
change, 0 unchanged` on that corpus, which preflight's no-op check turns into
  an abort rather than a 1 ms "win". All confirmed via `--list`.
- **Version**: `tsv --version`, asked of the binary by
  `bench-all-and-update-readme.mjs`, cross-checked against the platform
  package's version (see Running, above).

### Setting up the tsv binary

`resolveTsv` in `shared/utils.mjs` picks the binary: `TSV_BIN` if set, else the
platform package. Two ways to get one in place:

- **npm (default):** `pnpm install` installs `@fuzdev/tsv` and, as its optional
  dependency, the one `@fuzdev/tsv-<triple>` package for this machine, which
  carries the `tsv` binary beside the N-API addon. Nothing to build; the version
  is whatever the lockfile pins. `init.sh` only confirms it resolves. Note pnpm
  keeps it under `node_modules/.pnpm/`, not hoisted to `node_modules/@fuzdev/`,
  which is why `resolveTsv` resolves it from `@fuzdev/tsv`'s real location the
  way the package's own `bin.js` does.

- **A local build (a dev branch, or a platform the package doesn't ship for):**
  build it in a tsv checkout and point the harness at it:

  ```bash
  # in the tsv repo
  cargo build --release -p tsv_cli          # → target/release/tsv

  # then run the bench against it
  TSV_BIN=../tsv/target/release/tsv pnpm run bench
  ```

  `TSV_BIN` is used as-is — nothing rebuilds or overwrites it — and
  `update-readme` reads the version from the binary and stamps the line with
  the file's mtime, since a local build's version string doesn't move between
  builds. That mtime is the file's, so for a copied binary it is when it was
  **copied**, not built (`cp -p` preserves the build time). A README generated
  this way names an unreleased build; regenerate from npm before publishing.

### Future tsv work (planned, not yet done)

The current coverage is the JS/TS family plus Svelte (`bench-svelte`). tsv also
formats `.css`, and that parser is **not yet exercised** by any scenario.
Candidates:

- A CSS corpus so tsv's CSS parser gets benchmarked.
- **A multi-file leg for `bench-tsv-delivery`.** It benches one file on purpose —
  the native binary's thread pool and the WASM CLI's worker pool (tsv 0.3+,
  above a file-count threshold) have different costs, so a tree would fold core
  count and pool warm-up into what reads as delivery cost. A second,
  clearly-labelled multi-file row would measure the thing one file can't: what
  each distribution costs on a real project. The corpus would need enough files
  to clear the WASM CLI's threshold (`WORKER_FILE_THRESHOLD` in its `cli.js`), or
  it silently measures the single-threaded path.
- tsv-scoped variants of the embedded scenarios (`bench-mixed-embedded`,
  `bench-full-features`) — i.e. narrowing those corpora to tsv's supported set
  rather than leaving tsv out of them entirely.
- Preflight for the three tsv-free scenarios. It only guards the four tsv-inclusive
  ones today; the `--ignore-failure` caveat applies everywhere, it just
  has no known bite where every formatter is a JS-native tool.
- Command-level error signals for biome and oxfmt. `PREFLIGHT_ERROR_SIGNALS` covers
  prettier, tsv, and tsv-wasm; the other two have no error prefix that couldn't fire on an
  ordinary check run, so a failure that formats nothing still reads as clean there.
  A file-count assertion ("the tool reported looking at ≥ 1 files") would cover all
  of them, at the cost of another per-tool matcher to keep alive.
- **Pin the cloned corpora.** `init.sh` and both workflows clone
  outline/storybook/continue at their default-branch HEAD, unpinned, so the corpus
  drifts and a rerun months apart is not comparable — and outline is now cloned
  twice, which can land two different commits. `bench-large-single-file` already
  pins (`v5.9.2`); the clones should too. `bench-svelte` is the exception:
  `setup-corpus.mjs` reads its seven sources from the fuzdev/corpora snapshot at the
  commit and `collections/` tree id pinned in `corpora-pin.mjs`, so that corpus
  reproduces from one SHA, its snapshot commit is deterministic over the bytes,
  and `bench.mjs` refuses a `data/` built at any other pin (see the rsvelte-fmt
  section). Until the rest are pinned, each scenario at least prints and records a
  `Corpus:` line (`describeCorpus`, via `printCorpus`) naming the commit and date it
  ran against — or, for the single downloaded file, its size and content hash — so
  two runs can be told apart instead of silently differing.

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
  therefore includes one Node cold start — its shipped CLI posture, same as
  measuring prettier's Node. The memory row is **not** that tree's sum: `%M`
  takes a max over waited-for children (see the harness section), and the native
  binary outgrows the ~45 MB launcher, so the row is the binary's peak and the
  launcher is the part not counted. On this `.svelte`-only corpus the
  oxfmt delegation leg spawns on zero files (and prints a "No config found"
  notice — the directory hand-off doesn't forward `--config`); that overhead is
  part of how `rsvelte-fmt <dir>` ships, so it deliberately stays.
- **Config parity**: rsvelte-fmt is configurable where tsv is not, so
  `bench-svelte/oxfmtrc.json` pins it to tsv's fixed style — `printWidth: 100`,
  `useTabs`, `singleQuote`, `trailingComma: "none"` — making break decisions
  and output volume comparable. This scenario set the precedent the other two
  tsv-inclusive ones now follow (see the style-parity note above).
- **The corpus** (`setup-corpus.mjs`): a `.svelte`-only snapshot of seven
  third-party sources, read out of the
  [fuzdev/corpora](https://github.com/fuzdev/corpora) snapshot at the commit
  pinned in `corpora-pin.mjs`: kit (`packages/kit/src`) and svelte.dev
  (`apps/svelte.dev/src`, `packages/repl/src`, `packages/site-kit/src`) — the same
  trees tsv's own bench corpus uses (`svelte` is absent on purpose:
  `packages/svelte/src` is the compiler, zero `.svelte` files) — plus five Svelte
  libraries: layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake.
  The snapshot already leaves each upstream's test fixtures behind, so the only
  filter here is the extension. 2,226 files / ~4.1MB at the current pin, all
  third-party and prettier-shaped — neither benched formatter is measured on code
  it already shaped, and both would rewrite ~92% of the files, so write volume is
  symmetric too. That fairness premise is checked, not assumed: the manifest names
  who shaped each collection (`shaped_by`), and the build refuses one shaped by a
  formatter this scenario benches.
- **Where the bytes come from, and what is pinned.** The script never reads a
  working tree: it extracts from git's object store (`read-tree` +
  `checkout-index`, no `tar`), from the first of `$CORPORA_DIR`, the sibling
  `../corpora` checkout (the workspace default), or a gitignored
  `bench-svelte/corpora/` cache it fills with a depth-1 fetch of the pinned commit
  from GitHub — so a fresh machine or CI builds it with nothing but network. A
  sibling that's behind the pin is an error with a fetch hint, not a silent
  fallback. `corpora-pin.mjs` pins **both** the commit (what a reader fetches) and
  the `collections/` tree id (what the corpus _is_ — corpora's own README says
  consumers pin the tree, and it's what tsv's `GATE_CHECKOUT_IDS` pins), and the
  build asserts the commit carries that tree, plus an `EXPECTED_FILES` count so a
  pin bump that moves the corpus has to say so in the diff. Bumping the pin is
  those three constants.
- **Why a snapshot, and why `git init`**: the two tools discover files
  differently (tsv is config-free and gitignore-aware; rsvelte-fmt walks
  `.svelte` itself and hands the rest of a directory to oxfmt, which would pick
  up `.json`/`.md`/etc), so a tree containing only the corpus files is the one
  way to pin both to the same set — both self-report the same count (2,226 at the
  current pin), which preflight now asserts every run. The
  `git init` makes `data/` its own git root (sidestepping the outer
  `.gitignore` trap described above) and provides the reset-per-run baseline;
  provenance (the corpora pin line, then per-source commit + file count) is
  recorded in the snapshot's commit message, and the commit itself is
  deterministic — fixed author, the corpora commit's date — so identical bytes
  give an identical snapshot SHA on every machine, which is what the scenario's
  `Corpus:` line prints beside the pin. `bench.mjs` reads that pin line back and
  refuses a `data/` built at any other pin, since `setup-corpus.mjs` only ever
  builds a _missing_ `data/` (staged in a gitignored `data.tmp/` and renamed into
  place last, so an interrupted build never leaves a half-corpus). Regenerate with
  `rm -rf bench-svelte/data && node ./bench-svelte/setup-corpus.mjs`.
- **No `--ignore-failure`** (alone among the scenarios): both formatters exit 0
  on a successful write run, so any non-zero exit here is a real error — and
  rsvelte-fmt 0.7.x has a SIGABRT (its launcher propagates signal deaths as exit
  128+n, e.g. 134) that must abort the benchmark rather than be timed as a fast
  partial run. It fires only when stdout and stderr **share one pipe**, on the
  pass that prints bulk output. Counted over this corpus:

  | version | pass                            | stdio              | crashes  |
  | ------- | ------------------------------- | ------------------ | -------- |
  | 0.7.23  | `--check` (what preflight runs) | both on one pipe   | 24 / 100 |
  | 0.7.23  | `--check`                       | out=pipe, err=file | 0 / 40   |
  | 0.7.23  | `--check`                       | out=file, err=pipe | 0 / 40   |
  | 0.7.23  | `--check`                       | both to files      | 0 / 180  |
  | 0.7.23  | `--check`                       | out=/dev/null      | 0 / 40   |
  | 0.7.23  | `--check`                       | under hyperfine    | 0 / 30   |
  | 0.7.23  | write (what the timed runs run) | both on one pipe   | 0 / 210  |
  | 0.7.23  | write                           | both to files      | 0 / 140  |
  | 0.7.11  | `--check`                       | both on one pipe   | 8 / 40   |
  | 0.7.11  | write                           | both on one pipe   | 0 / 40   |

  **The cause is EAGAIN on a non-blocking stdout.** The native binary launches
  oxfmt under Node, with inherited stdio, for the non-`.svelte` leg while its own
  threads are still printing; oxfmt writes to stderr, and libuv sets `O_NONBLOCK`
  on that pipe. With `2>&1`, stderr is a dup of stdout — one open file
  description — so the binary's stdout turns non-blocking too. Check mode prints
  a `would format <path>` line per rewritten file (~2,000, well past a 64 KiB
  pipe buffer); when the reader falls behind, a write returns EAGAIN, Rust's
  `println!` panics (`failed printing to stdout: Resource temporarily
unavailable (os error 11)`), and the release build aborts. The panic message is
  usually lost, since stderr is the same full pipe; it surfaced once in a dozen
  crashes. That accounts for every row above: a file or `/dev/null` never returns
  EAGAIN, split streams keep oxfmt's flag off the binary's stdout, hyperfine
  gives the children `/dev/null`, write mode prints one line, and a slower reader
  crashes more often. A crashed check was also **truncated** (514 of 2029 lines,
  cut at the same file twice), so its "no matcher hits" would have read as clean
  over a corpus mostly never checked — which is why a crash aborts rather than
  passing.

  **`runPreflight` merges into a file, not a pipe** (`cmd > file 2>&1`, read back
  after), which keeps the interleaved diagnostics the matchers read and never
  returns EAGAIN: 0 crashes in 25 consecutive preflights where the shared pipe
  had crashed 7 of 12. It is a harness-level dodge of a real rsvelte-fmt defect —
  `rsvelte-fmt --check … 2>&1 | tee` in CI still hits it — so a rsvelte-fmt
  upgrade is worth re-checking against a shared pipe. The timed runs never had
  the exposure (hyperfine, above), and the memory pass, which still merges into
  a pipe, runs the one-line write command.

  **An aborted scenario is publishable**, should any abort remain. It
  writes its banner, preflight rows, and the `→ aborting:` line into the README
  with no timings under it, and records the same in `results.json` (`aborted`,
  the preflight rows, no timings); tsv.fuz.dev renders the scenario as aborted —
  naming the formatter whose preflight row faulted — rather than dropping it or
  refusing the report. The memory pass is strict the same way (`failOnCrash`): a
  run killed by a signal there aborts after timing, so the block carries timings
  and a `Summary` but no `Memory Usage:` table, the record carries timings and
  `aborted` but no `memory`, and the site renders the times with the abort note
  under them.

- **Quick runs**: `BENCH_WARMUP=0 BENCH_RUNS=1 BENCH_SETTLE_S=0 node ./bench-svelte/bench.mjs`
  overrides the scenario's default run counts for a fast, low-accuracy smoke run — see "Quick
  runs" under Scenarios for the other three scenarios that take it.
- **Version**: `vp exec rsvelte-fmt --version` in
  `bench-all-and-update-readme.mjs` (an npm bin, so `vp exec` reaches it where it
  can't reach tsv's native binary).

## The tsv-wasm row (bench-tsv-delivery)

[`@fuzdev/tsv-wasm`](https://www.npmjs.com/package/@fuzdev/tsv-wasm) is the third
fork-added formatter, and the only one that isn't a different _formatter_ at all:
it is tsv's own CLI over a WASM engine, the distribution anyone on a platform
without a prebuilt native binary falls back to. It runs in one scenario,
`bench-tsv-delivery`, against native tsv and the tsv-npm row (next section).

- **The question it answers** is what a delivery path costs, not which formatter
  is faster — so it is deliberately kept out of the comparison scenarios. A row
  belongs in one of those if it's the honest counterpart to how the other tools
  there are measured (which is why the tsv-npm row is in all three — next
  section). Nothing benched against tsv is a WASM build, so a WASM row there
  would only blur hyperfine's `Summary` ratios across two different questions.
- **Binary**: `node_modules/.bin/bench-tsv-wasm`, a harness-derived bin shim
  over `@fuzdev/tsv-wasm/cli.js` (a devDependency, so `pnpm install` covers it)
  — not `node_modules/.bin/tsv`, because the native `@fuzdev/tsv` claims that
  same `tsv` bin name. pnpm happens to give `.bin/tsv` to this package whenever
  both are installed (its rule is in the tsv-npm section), but that is the
  package manager's tie-break, not a contract — a row addressed by that name
  would change distribution under another package manager or a renamed package,
  and this row has to be the WASM one every time.
- **Same CLI contract as the native binary**, mirrored in JS (`cli.js`, the one
  source both `@fuzdev/tsv-wasm` and `@fuzdev/tsv`'s fallback ship) —
  subcommands, flags, exit codes, traversal and hierarchical-ignore rules,
  diagnostics, and the `N would change, M unchanged` summary line, all
  identical. So it shares tsv's
  entries in all three preflight tables (`TSV_DIAGNOSTIC`, `TSV_SCOPE_COUNTS`,
  and an error signal that also catches Node's own `Cannot find module` — the
  failure mode a path-addressed script has and a bin doesn't). It still carries
  its own `preflight-selftest.mjs` case.
- **A worker pool of its own since tsv 0.3**: `--jobs` fans multi-file runs onto
  `node:worker_threads` once a run clears a file-count threshold; on one file it
  is a single thread. This is why the scenario benches **one file**: the native
  binary clamps its pool to the file count and the WASM CLI stays under its
  threshold, so every row is honestly single-threaded and the comparison is the
  fixed cost of each delivery, where a tree would fold core count and two
  different pools' warm-up into what reads as engine cost.
- **Reading its numbers**: `[User: …]` is not an engine proxy here. V8 tiers hot
  wasm functions up on background threads (baseline compilation is lazy, on the
  main thread), so the wasm row's User time can run well above its wall time even
  on a single file, and by a margin that varies run to run — that's compilation,
  not formatting.
  The memory row is likewise the whole Node process: heap plus the wasm
  instance's linear memory, which is the honest figure for this distribution but
  not an engine-vs-engine comparison with the native binary's RSS.
- **Version**: read from the installed package's `package.json` by
  `bench-all-and-update-readme.mjs` and published as `**tsv-wasm**` in the
  README's `## Versions` list. The mirror image of the native binary's situation:
  the WASM CLI has no `--version` flag but does have an npm manifest, where the
  native binary has the flag and no manifest.
- **Quick runs**: `BENCH_WARMUP=0 BENCH_RUNS=1 BENCH_SETTLE_S=0 node ./bench-tsv-delivery/bench.mjs`,
  as in the other three tsv scenarios.

## The tsv-npm row

Not another build of tsv but another
way of reaching the same native binary: [`@fuzdev/tsv`](https://www.npmjs.com/package/@fuzdev/tsv)'s
`tsv` bin, a Node dispatcher that resolves the platform package's binary and
`spawnSync`s it, forwarding argv, stdio, exit codes and signals verbatim. It is
how `npx tsv` and most npm installs run tsv, so it is the delivery most users pay
for: one Node cold start plus a spawn on top of the native row.

It runs in all four tsv scenarios, for two reasons:

- **`bench-ts-only`, `bench-large-single-file` and `bench-svelte`** — as the
  like-for-like row. prettier, biome, oxfmt and rsvelte-fmt are all timed through
  `node_modules/.bin/`, a shim that execs Node on the package's bin script;
  biome's and rsvelte-fmt's then launch a native binary, the same shape as tsv's
  dispatcher. The bare-binary tsv row
  skips that Node start, so on its own it overstates what someone who installed
  tsv from npm sees against those tools — by the most on the single file, where
  launch is the largest share of a short run. tsv-npm is the row to read against
  them; native tsv stays as the engine-side figure and the baseline every ratio
  is taken against, so hyperfine's `Summary` and the memory ratios keep their
  anchor across regenerations.
- **`bench-tsv-delivery`** — as one of the three distributions, against native
  tsv and tsv-wasm.

- **Binary**: `node_modules/.bin/bench-tsv-npm`, a harness-derived bin shim
  over `@fuzdev/tsv/bin.js` (see the shim entry below for why it isn't
  `.bin/tsv`). The binary it dispatches to is the very file the tsv row runs
  directly — unless `TSV_BIN` is set, which redirects only the tsv row: the
  dispatcher resolves its own platform package and never reads it, so under
  `TSV_BIN` the two rows are different builds and their gap is not just dispatch
  cost.
- **Preflight**: shares all three of tsv's table entries, since the dispatcher
  forwards the binary's output unchanged, plus one signal of its own: the
  warning the dispatcher prints when it cannot run the native binary and falls
  back to the JS CLI. Without that, a broken platform package would be timed as
  the wrong distribution under this row's name. It has its own self-test case.
- **Reading its numbers**: the difference between this row and the tsv row is
  the dispatch cost, and nothing else — same binary, same file, same thread
  count. That cost is ~30 ms in every scenario, and the bin shim below is only a
  tenth of it. Layer by layer (`hyperfine -N`, `--version`, 100 warm runs):
  `node -e ""` 19.5 ms, an empty `.mjs` ~22, a `.mjs` importing the dispatcher's
  five `node:` builtins 27.0, `node bin.js` 28.9, through the shim 32.4 — against
  0.8 ms for the binary alone. So ~20 ms is Node, ~10 ms the dispatcher's own
  ES-module entry, imports, resolve and spawn, ~3 ms the shim. Its memory row is **not** the Node process plus the child: GNU time
  reports the largest single process in the tree, which here is the Node
  dispatcher (~50 MB) whatever the binary under it uses — so the row is flat
  across scenarios and says what the launcher costs, not what tsv does. biome's
  and rsvelte-fmt's rows have the same shape from the other side (their native
  binary outgrows the launcher, so the launcher is the part not counted).
- **The bin shim** (`resolveTsvNodeBin`). The other tools' rows go through
  pnpm's `node_modules/.bin/<tool>`, a generated `sh` script (`dirname`, `sed`,
  `uname`, a `command -v node`, then `exec node <bin script>`). Measured here
  with `hyperfine -N`: `.bin/biome --version` 34.3 ms against
  `node …/@biomejs/biome/bin/biome --version` 31.1 ms, so **~3 ms** per
  invocation — small against the multi-file rows, ~6% of this row on the single
  file. Run as `node <script>` by path, this row and tsv-wasm's would skip it:
  an edge no other row gets. (An npm install has no such script — its `.bin`
  entries are symlinks run through the `#!/usr/bin/env node` shebang — so it is
  a pnpm artifact of this harness, not a cost tsv dodges in the wild; but the
  rows have to pay the same one.)

  They can't use `.bin/tsv`: `@fuzdev/tsv` and `@fuzdev/tsv-wasm` both declare a
  `tsv` bin, and pnpm resolves the conflict deterministically — the package
  whose name _equals_ the bin name wins, else the name that sorts higher
  (`compareCommandsInConflict` in pnpm's bin linker:
  `a.pkgName.localeCompare(b.pkgName)`). Neither is named `tsv`, and
  `@fuzdev/tsv-wasm` sorts after `@fuzdev/tsv`, so with both installed
  `.bin/tsv` is **always the WASM CLI** (the `# cmd-shim-target=` line at the
  bottom of the shim says which).

  So the harness writes each row a shim of its own, `.bin/bench-tsv-npm` and
  `.bin/bench-tsv-wasm`, **derived from the `.bin/tsv` pnpm did write**: that
  script with its package's path spellings (the exec lines' relative target, the
  trailer's absolute one, NODE_PATH's store directories) swapped for this row's.
  Copying the live script rather than carrying a template is the point — the cost
  tracks whatever pnpm version installed the other tools, and the WASM shim comes
  out byte-identical to pnpm's. It lives in `.bin/` because the script addresses
  its target relative to itself; it is rewritten only when its text would change.

  **pnpm spells those paths two ways** — through the hoisted
  `node_modules/<pkg>` symlink, or through the store path that symlink points at
  (`node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`) — and which one it
  writes has moved between installs of the same pnpm version. So the derivation
  matches and validates by what a path **resolves to**, never by how it is
  spelled, and rewrites both spellings; an exact-string match silently lost the
  shim (and the ~3 ms with it) the first time pnpm switched. The result is
  validated before use: every `exec` line must resolve to this row's script, and
  the text must not still name the other package. Anything else — no
  `cmd-shim-target` trailer (npm, yarn), a package missing, a shim whose shape
  moved — falls back to `node <script>` by path, and the
  scenario prints a `- tsv-npm: no pnpm bin shim to copy …` line into its
  output so a published table carries the difference with it.
  `preflight-selftest.mjs` reports the same thing before a run starts.

  Measured with the shim, tsv-npm on `parser.ts` is ~48 ms where by path it is
  ~45 (hyperfine's own `bash` plus the shim's `sh` and its subprocesses) — the
  same ~3 ms the biome comparison above shows. Read the gap, not the absolute:
  the row's own figure moves with every tsv release.

  Alternatives considered: moving `@fuzdev/tsv-wasm` into its own workspace
  member so both packages get real pnpm shims (clean, but a new workspace
  package and a lockfile change for ~3 ms); and the fix at the source, a
  non-colliding bin name on `@fuzdev/tsv-wasm` — which would also stop anyone
  who installs both under pnpm from silently getting the WASM CLI from `tsv`,
  and would let this derivation be deleted in favour of the real bins. Not an
  option: invoking every tool as `node <bin script>`, which levels the rows by
  taking upstream's off the path their users run.

- **Version**: the platform package's, which is `@fuzdev/tsv`'s — the same
  version the tsv row publishes.
