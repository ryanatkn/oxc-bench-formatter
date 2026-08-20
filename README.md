# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** The upstream scenarios are unchanged — everything here is additive.
>
> - **[tsv](https://tsv.fuz.dev)** is a native-Rust formatter for the JS/TS family, CSS, and Svelte. It's built from a sibling `../tsv` checkout (or `TSV_BIN`), not installed from npm.
> - **It has no JSX/TSX parser**, so it runs only where the corpus is JSX-free: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only`, which benches Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set.
> - **`bench-svelte`** (also fork-added) puts tsv head-to-head with [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on ~2,230 third-party `.svelte` files, with rsvelte-fmt configured to tsv's fixed style (width 100, tabs, single quotes) so output volume is comparable.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions). Full methodology in [CLAUDE.md](CLAUDE.md).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [tsv](https://tsv.fuz.dev/)

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
node ./bench-svelte/bench.mjs
```

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
  - [Outline](https://github.com/outline/outline) again, scoped to its non-JSX subset (`.ts`/`.js`/`.mjs`) — the set every formatter including tsv supports (fork-added)
  - A `.svelte`-only snapshot of seven third-party sources: SvelteKit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake (fork-added)
- **Methodology**:
  - Multiple warmup runs before measurement
  - Multiple benchmark runs for statistical accuracy
  - Git reset before each run to ensure identical starting conditions
  - Memory usage measured using GNU time (peak RSS)
  - Local binaries via `./node_modules/.bin/`; tsv is a native binary from `../tsv/target/release/tsv` (or `TSV_BIN`)
  - The tsv scenarios run a preflight parse check first — if any formatter rejects a file, that scenario aborts instead of timing a comparison the tools didn't run on the same work

## Versions

- **Prettier**: 3.9.5
- **Biome**: 2.5.4
- **Oxfmt**: 0.60.0
- **rsvelte-fmt**: 0.7.4
- **tsv**: 0.1.0

_Measured on: AMD Ryzen 5 PRO 7530U with Radeon Graphics · 12 threads · linux x64 — the ratios below depend on the core count._

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
