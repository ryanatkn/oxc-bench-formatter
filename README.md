# JavaScript/TypeScript Formatter Benchmark

Fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter) with tsv — comparing execution time and memory usage of [Prettier](https://prettier.io/), [Biome](https://biomejs.dev/), [Oxfmt](https://oxc.rs), and [tsv](https://tsv.fuz.dev).

> **About this fork:** adds [tsv](https://tsv.fuz.dev) (native-Rust JS/TS, CSS, and Svelte formatter) to the comparison. tsv has no JSX/TSX parser, so it runs only in the JSX-free scenarios — `bench-large-single-file` (`parser.ts`) and `bench-ts-only`, a fork-added scenario benching Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set. The upstream scenarios are unchanged. tsv is a native binary built from a sibling `../tsv` checkout (or `TSV_BIN`), not an npm package. Start with [How to read these numbers](#how-to-read-these-numbers) — the ratios are machine-dependent and measure the CLI, not the engine. See also [Why tsv isn't in every scenario](#why-tsv-isnt-in-every-scenario), [Formatters](#formatters), and [CLAUDE.md](CLAUDE.md).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [tsv](https://tsv.fuz.dev) — native Rust; the JS/TS family (`.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs`, all parsed as TypeScript) plus CSS and Svelte. No JSX/TSX, so it runs only in the JSX-free scenarios ([why](#why-tsv-isnt-in-every-scenario))

## Run

```bash
# Run all benchmarks
# Automatically setup fixture if not exists
pnpm run bench

# Or explicit benchmark with manual setup
./init.sh
node ./bench-large-single-file/bench.mjs
node ./bench-js-no-embedded/bench.mjs
node ./bench-mixed-embedded/bench.mjs
node ./bench-full-features/bench.mjs
node ./bench-ts-only/bench.mjs
```

Regenerate the results below with `pnpm run update-readme`. Run it **locally**,
where a sibling `../tsv` checkout exists — CI does not build tsv, so a CI run
silently drops tsv from the results, and its core count would not match the rest
of the table anyway.

## Notes

- Each formatter runs on the exact same codebase state (git reset between runs)
- Times include both parsing and formatting of all matched files
- Memory measurements track peak resident set size (RSS) during execution
- I intended to bench checker.ts, but it appears to be running for a very long time or stuck with 100% CPU.

## Benchmark Details

- **Test Data**:
  - TypeScript compiler's [parser.ts](https://github.com/microsoft/TypeScript/blob/v5.9.2/src/compiler/parser.ts) (~13.7K lines, single large file)
  - [Outline](https://github.com/outline/outline) repository (JS/JSX/TS/TSX only)
  - [Storybook](https://github.com/storybookjs/storybook) repository (mixed with embedded languages)
  - [Continue](https://github.com/continuedev/continue) repository (full features: sort imports + Tailwind CSS)
  - [Outline](https://github.com/outline/outline) again, scoped to its non-JSX subset (`.ts`/`.js`/`.mjs`) — the fork's `bench-ts-only`, the common file set every formatter including tsv supports
- **Corpora are not pinned**: the three cloned repos are shallow-cloned at their
  default-branch HEAD, so the corpus drifts over time and runs taken months apart
  are not strictly comparable (`parser.ts` is pinned to v5.9.2)
- **Methodology**:
  - Multiple warmup runs before measurement
  - Multiple benchmark runs for statistical accuracy
  - Git reset before each run to ensure identical starting conditions
  - Memory usage measured using GNU time (peak RSS)
  - Local binaries via `./node_modules/.bin/`

## How to read these numbers

This suite measures the **whole CLI** — process spawn, file discovery, I/O, and
whatever parallelism each tool does by default. That is what a user experiences
typing the command, and it is the intended measure. It is **not** a formatter
engine comparison, and the headline ratios should not be read as one.

**The ratios depend on the machine.** The harness never caps threads, so each
formatter runs at its own default: biome, oxfmt, and tsv parallelize across files,
while prettier is effectively serial. The multiplier between a parallel tool and a
serial one therefore scales with core count — the same oxfmt-vs-biome comparison
measures ~3.5x on a 4-core CI runner and ~1.7x on a 12-thread laptop. Neither is
wrong; they are answers to "on what hardware?". The machine for the numbers below
is recorded under [Versions](#versions), and every row must come from one machine
to be comparable.

**Separating the engine from the thread count.** hyperfine prints `[User: …]`
next to each wall time. User time is total CPU across all threads, so `User ÷ wall`
is roughly how many cores a tool kept busy, and comparing _User_ times is the
parallelism-neutral view. A tool that is 100x faster in wall-clock may be ~25x
faster per unit of CPU work, with the rest coming from using cores its competitor
left idle. Both numbers are real; they answer different questions.

Two caveats on that:

- **User time is only a clean engine proxy when threads are doing real work.** In
  `bench-large-single-file` there is one file to format, yet oxfmt still reports
  more User than wall time — it spins up a worker pool it cannot use. That
  overhead inflates its User time without being formatting work, so the CPU-work
  comparison in that scenario is not engine-vs-engine either. (tsv clamps its
  worker count to the file count and biome likewise stays single-threaded there,
  so this is specific to oxfmt.)
- **No thread flags are passed.** oxfmt exposes `--threads` and tsv `--jobs`, but
  biome exposes nothing equivalent, so a pinned single-thread comparison cannot
  cover every formatter — and pinning would stop measuring what the suite is for.
  Every tool runs at its default, deliberately.

**Formatting width is not identical.** prettier, biome, and oxfmt format at width
80 (oxfmt explicitly, the other two by default). tsv is non-configurable and always
formats at width 100, so it cannot be aligned. Different widths mean different
line-break decisions and different output volume — a real if small asymmetry with
no fix available on tsv's side.

**Errors are not penalized.** hyperfine runs with `--ignore-failure` and the memory
pass swallows command errors, so a formatter that _rejects_ part of a corpus would
still be timed — and look faster for the work it skipped. The two tsv scenarios run
a preflight parse check first and report what each formatter rejects; both corpora
are currently clean for all five.

## Why tsv isn't in every scenario

tsv runs in only two of the five scenarios — `bench-large-single-file` and
`bench-ts-only`. It is deliberately left out of `bench-js-no-embedded`,
`bench-mixed-embedded`, and `bench-full-features` for two independent reasons,
either of which alone would be disqualifying:

- **Parser.** tsv parses the JS/TS family, CSS, and Svelte, but has no JSX/TSX
  parser. All three excluded corpora (Outline, Storybook, Continue) contain
  `.tsx`, and JSX inside a `.js` file is a parse error for tsv (exit 2) where
  prettier, biome, and oxfmt format it happily. Because hyperfine runs with
  `--ignore-failure`, a formatter that rejected part of the corpus would be
  _timed while skipping that work_ and look artificially fast — so tsv cannot
  simply be pointed at these corpora.
- **Feature scope.** Even scoped down to plain non-JSX TypeScript, two of these
  scenarios measure work tsv does not do. `bench-mixed-embedded` measures
  **embedded-language formatting**: reformatting a snippet of one language nested
  inside another file — CSS in a `styled-components` template literal, GraphQL in
  a `gql` tag, code fences in markdown, `<style>`/`<script>` blocks, and so on.
  `bench-full-features` measures import sorting and Tailwind class sorting. tsv
  formats whole `.ts`/`.css`/`.svelte` files and is non-configurable — it has no
  plugins, does not reach into template literals, and does not sort imports or
  classes. It would pass those files through _without doing the measured work_ and
  still post a fast time — unfair in the opposite direction from erroring, and
  quieter.

`bench-ts-only` is the fair way to put tsv on a real-world repo: Outline minus its
`.tsx` files, with every formatter scoped to the same `.ts`/`.js`/`.mjs` set and a
preflight parse check confirming none of them reject anything.
`bench-large-single-file` is a single `.ts` file and needs no such care. The honest
way to widen tsv's coverage is new scenarios for its other two parsers — a CSS
corpus and a Svelte corpus, neither present in Outline — not forcing it into
feature comparisons it structurally loses on a technicality.

## Versions

- **Prettier**: 3.9.5
- **Biome**: 2.5.4
- **Oxfmt**: 0.60.0
- **tsv**: 0.1.0

_Measured on: AMD Ryzen 5 PRO 7530U with Radeon Graphics · 12 threads · linux x64 — the ratios below depend on the core count; see [How to read these numbers](#how-to-read-these-numbers)._

## Results

<!-- BENCHMARK_RESULTS_START -->

```
=========================================
Benchmarking Large Single File
=========================================

Target: TypeScript compiler parser.ts (~540KB)
- 2 warmup runs, 5 benchmark runs
- Copy original before each run


Preflight (per-formatter parse check):
  prettier: clean
  prettier+oxc-parser: clean
  biome: clean
  oxfmt: clean
  tsv: clean
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      1.605 s ±  0.022 s    [User: 1.541 s, System: 0.858 s]
  Range (min … max):    1.572 s …  1.623 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     985.0 ms ±   4.8 ms    [User: 889.0 ms, System: 462.3 ms]
  Range (min … max):   977.6 ms … 990.0 ms    5 runs

Benchmark 3: biome
  Time (mean ± σ):     113.9 ms ±   1.7 ms    [User: 87.1 ms, System: 34.6 ms]
  Range (min … max):   112.2 ms … 116.7 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     195.8 ms ±   9.4 ms    [User: 354.4 ms, System: 201.4 ms]
  Range (min … max):   188.1 ms … 211.9 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      23.8 ms ±   0.2 ms    [User: 14.9 ms, System: 8.8 ms]
  Range (min … max):    23.6 ms …  24.1 ms    5 runs

Summary
  tsv ran
    4.79 ± 0.08 times faster than biome
    8.24 ± 0.40 times faster than oxfmt
   41.44 ± 0.43 times faster than prettier+oxc-parser
   67.55 ± 1.13 times faster than prettier

Memory Usage:
  prettier: 305.9 MB (min: 293.4 MB, max: 313.3 MB, 12.34 ± 0.44 times more than tsv)
  prettier+oxc-parser: 196.2 MB (min: 194.6 MB, max: 197.9 MB, 7.91 ± 0.19 times more than tsv)
  biome: 101.0 MB (min: 98.0 MB, max: 104.0 MB, 4.07 ± 0.13 times more than tsv)
  oxfmt: 118.6 MB (min: 118.6 MB, max: 118.7 MB, 4.79 ± 0.11 times more than tsv)
  tsv: 24.8 MB (min: 24.2 MB, max: 25.6 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.776 s ±  0.125 s    [User: 19.919 s, System: 1.346 s]
  Range (min … max):   11.604 s … 12.047 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.501 s ±  0.130 s    [User: 12.339 s, System: 0.718 s]
  Range (min … max):    9.310 s …  9.712 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     494.7 ms ±   3.0 ms    [User: 3593.1 ms, System: 481.0 ms]
  Range (min … max):   490.2 ms … 500.7 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     286.3 ms ±  13.1 ms    [User: 1089.8 ms, System: 484.3 ms]
  Range (min … max):   269.8 ms … 307.8 ms    10 runs

Summary
  oxfmt ran
    1.73 ± 0.08 times faster than biome
   33.19 ± 1.58 times faster than prettier+oxc-parser
   41.13 ± 1.93 times faster than prettier

Memory Usage:
  prettier: 450.0 MB (min: 405.9 MB, max: 541.8 MB, 1.93 ± 0.22 times more than oxfmt)
  prettier+oxc-parser: 334.5 MB (min: 313.2 MB, max: 376.5 MB, 1.43 ± 0.10 times more than oxfmt)
  biome: 276.8 MB (min: 271.2 MB, max: 279.4 MB, 1.18 ± 0.04 times more than oxfmt)
  oxfmt: 233.6 MB (min: 220.9 MB, max: 245.5 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.650 s ±  0.298 s    [User: 57.245 s, System: 6.985 s]
  Range (min … max):   51.329 s … 51.916 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.991 s ±  0.345 s    [User: 81.871 s, System: 5.802 s]
  Range (min … max):    7.723 s …  8.380 s    3 runs

Summary
  oxfmt ran
    6.46 ± 0.28 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1728.8 MB (min: 1596.6 MB, max: 1833.8 MB, 4.15 ± 0.37 times more than oxfmt)
  oxfmt: 416.3 MB (min: 401.5 MB, max: 442.8 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.596 s ±  0.335 s    [User: 33.891 s, System: 2.190 s]
  Range (min … max):   25.376 s … 25.982 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.272 s ±  0.044 s    [User: 31.647 s, System: 3.100 s]
  Range (min … max):    3.222 s …  3.302 s    3 runs

Summary
  oxfmt ran
    7.82 ± 0.15 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 675.7 MB (min: 623.5 MB, max: 750.1 MB, 2.18 ± 0.21 times more than oxfmt)
  oxfmt: 309.7 MB (min: 306.6 MB, max: 311.7 MB)

Full features benchmark complete!


=========================================
Benchmarking TypeScript-only (tsv-fair)
=========================================

Target: Outline repository (non-JSX JS/TS subset)
- 2 warmup runs, 5 benchmark runs
- Git reset before each run
- .ts/.js/.mjs only: the common file set every formatter (incl. tsv) supports


Preflight (per-formatter parse check):
  prettier: clean
  prettier+oxc-parser: clean
  biome: clean
  oxfmt: clean
  tsv: clean
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      8.250 s ±  0.118 s    [User: 13.524 s, System: 0.882 s]
  Range (min … max):    8.121 s …  8.382 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.740 s ±  0.024 s    [User: 8.533 s, System: 0.560 s]
  Range (min … max):    6.710 s …  6.768 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     361.6 ms ±   1.4 ms    [User: 2510.6 ms, System: 350.3 ms]
  Range (min … max):   359.7 ms … 363.1 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     278.2 ms ±  12.2 ms    [User: 867.6 ms, System: 433.7 ms]
  Range (min … max):   260.9 ms … 293.0 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      65.4 ms ±   2.9 ms    [User: 439.2 ms, System: 137.6 ms]
  Range (min … max):    63.2 ms …  70.2 ms    5 runs

Summary
  tsv ran
    4.25 ± 0.26 times faster than oxfmt
    5.53 ± 0.25 times faster than biome
  102.99 ± 4.59 times faster than prettier+oxc-parser
  126.06 ± 5.88 times faster than prettier

Memory Usage:
  prettier: 472.9 MB (min: 385.2 MB, max: 529.1 MB, 10.01 ± 1.38 times more than tsv)
  prettier+oxc-parser: 302.5 MB (min: 300.6 MB, max: 304.4 MB, 6.40 ± 0.37 times more than tsv)
  biome: 211.6 MB (min: 207.1 MB, max: 213.7 MB, 4.48 ± 0.26 times more than tsv)
  oxfmt: 229.5 MB (min: 215.2 MB, max: 243.2 MB, 4.86 ± 0.37 times more than tsv)
  tsv: 47.3 MB (min: 44.2 MB, max: 50.2 MB)

TypeScript-only (tsv-fair) benchmark complete!

=========================================
All benchmarks complete!
=========================================
```

<!-- BENCHMARK_RESULTS_END -->

# [Sponsored By](https://oxc.rs/sponsor)

<p align="center">
  <a href="https://oxc.rs/sponsor">
    <img src="https://raw.githubusercontent.com/oxc-project/sponsors/main/sponsors.svg" alt="Our sponsors" />
  </a>
</p>
