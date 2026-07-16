# JavaScript/TypeScript Formatter Benchmark

Fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter) with tsv — comparing execution time and memory usage of [Prettier](https://prettier.io/), [Biome](https://biomejs.dev/), [Oxfmt](https://oxc.rs), and [tsv](https://tsv.fuz.dev).

> **About this fork:** adds [tsv](https://tsv.fuz.dev) (native-Rust JS/TS, CSS, and Svelte formatter) to the comparison. tsv has no JSX/TSX parser, so it runs only in the JSX-free scenarios — `bench-large-single-file` (`parser.ts`) and `bench-ts-only`, a fork-added scenario benching Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set. The upstream scenarios are unchanged. tsv is a native binary built from a sibling `../tsv` checkout (or `TSV_BIN`), not an npm package. Start with [How to read these numbers](#how-to-read-these-numbers) — the ratios are machine-dependent and measure the CLI, not the engine. See also [Formatters](#formatters) and [CLAUDE.md](CLAUDE.md).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [tsv](https://tsv.fuz.dev) — native Rust; the JS/TS family (`.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs`, all parsed as TypeScript) plus CSS and Svelte. No JSX/TSX, so it runs only in the JSX-free scenarios

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

## Versions

- **Prettier**: 3.9.1
- **Biome**: 2.5.1
- **Oxfmt**: 0.59.0
- **tsv**: 0.2.0

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
  Time (mean ± σ):      1.597 s ±  0.015 s    [User: 1.583 s, System: 0.846 s]
  Range (min … max):    1.581 s …  1.614 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     503.4 ms ±   3.8 ms    [User: 751.3 ms, System: 99.0 ms]
  Range (min … max):   498.7 ms … 507.9 ms    5 runs

Benchmark 3: biome
  Time (mean ± σ):     138.8 ms ±   1.5 ms    [User: 107.3 ms, System: 38.7 ms]
  Range (min … max):   136.7 ms … 140.2 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     236.9 ms ±  23.8 ms    [User: 456.8 ms, System: 315.6 ms]
  Range (min … max):   216.3 ms … 268.2 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      28.8 ms ±   0.7 ms    [User: 15.2 ms, System: 13.5 ms]
  Range (min … max):    27.8 ms …  29.5 ms    5 runs

Summary
  tsv ran
    4.81 ± 0.12 times faster than biome
    8.22 ± 0.85 times faster than oxfmt
   17.46 ± 0.42 times faster than prettier+oxc-parser
   55.41 ± 1.36 times faster than prettier

Memory Usage:
  prettier: 303.2 MB (min: 291.5 MB, max: 319.4 MB, 13.12 ± 0.62 times more than tsv)
  prettier+oxc-parser: 184.4 MB (min: 181.8 MB, max: 187.2 MB, 7.98 ± 0.24 times more than tsv)
  biome: 102.6 MB (min: 101.1 MB, max: 104.2 MB, 4.44 ± 0.14 times more than tsv)
  oxfmt: 118.0 MB (min: 117.8 MB, max: 118.2 MB, 5.11 ± 0.15 times more than tsv)
  tsv: 23.1 MB (min: 22.5 MB, max: 23.9 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.919 s ±  0.206 s    [User: 20.045 s, System: 1.388 s]
  Range (min … max):   11.628 s … 12.331 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.775 s ±  0.082 s    [User: 13.039 s, System: 0.742 s]
  Range (min … max):    9.703 s …  9.915 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     494.1 ms ±   2.8 ms    [User: 4459.1 ms, System: 495.1 ms]
  Range (min … max):   490.6 ms … 498.9 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     290.6 ms ±  13.0 ms    [User: 1102.1 ms, System: 480.1 ms]
  Range (min … max):   276.4 ms … 317.2 ms    10 runs

Summary
  oxfmt ran
    1.70 ± 0.08 times faster than biome
   33.63 ± 1.53 times faster than prettier+oxc-parser
   41.01 ± 1.97 times faster than prettier

Memory Usage:
  prettier: 475.6 MB (min: 388.1 MB, max: 713.2 MB, 3.32 ± 0.76 times more than biome)
  prettier+oxc-parser: 335.5 MB (min: 329.0 MB, max: 350.6 MB, 2.34 ± 0.08 times more than biome)
  biome: 143.3 MB (min: 138.7 MB, max: 149.3 MB)
  oxfmt: 233.8 MB (min: 225.7 MB, max: 239.4 MB, 1.63 ± 0.05 times more than biome)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     46.138 s ±  0.330 s    [User: 56.091 s, System: 2.636 s]
  Range (min … max):   45.757 s … 46.330 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.832 s ±  0.209 s    [User: 82.370 s, System: 5.801 s]
  Range (min … max):    7.622 s …  8.040 s    3 runs

Summary
  oxfmt ran
    5.89 ± 0.16 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1406.2 MB (min: 1393.4 MB, max: 1423.6 MB, 3.53 ± 0.28 times more than oxfmt)
  oxfmt: 397.9 MB (min: 363.7 MB, max: 423.8 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.277 s ±  0.104 s    [User: 33.985 s, System: 2.004 s]
  Range (min … max):   25.158 s … 25.352 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.334 s ±  0.048 s    [User: 31.394 s, System: 3.198 s]
  Range (min … max):    3.285 s …  3.382 s    3 runs

Summary
  oxfmt ran
    7.58 ± 0.11 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 680.8 MB (min: 661.5 MB, max: 690.6 MB, 2.17 ± 0.09 times more than oxfmt)
  oxfmt: 313.4 MB (min: 304.9 MB, max: 324.2 MB)

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
  Time (mean ± σ):     10.911 s ±  0.089 s    [User: 17.611 s, System: 1.321 s]
  Range (min … max):   10.827 s … 11.011 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      8.979 s ±  0.060 s    [User: 11.237 s, System: 0.841 s]
  Range (min … max):    8.883 s …  9.025 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     784.3 ms ±   4.0 ms    [User: 7285.0 ms, System: 815.7 ms]
  Range (min … max):   777.8 ms … 787.8 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     379.8 ms ±   5.5 ms    [User: 1826.7 ms, System: 667.4 ms]
  Range (min … max):   370.3 ms … 383.6 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):     120.3 ms ±   1.4 ms    [User: 854.8 ms, System: 303.2 ms]
  Range (min … max):   118.7 ms … 121.9 ms    5 runs

Summary
  tsv ran
    3.16 ± 0.06 times faster than oxfmt
    6.52 ± 0.08 times faster than biome
   74.62 ± 1.01 times faster than prettier+oxc-parser
   90.67 ± 1.30 times faster than prettier

Memory Usage:
  prettier: 447.5 MB (min: 414.3 MB, max: 491.1 MB, 9.89 ± 1.11 times more than tsv)
  prettier+oxc-parser: 331.4 MB (min: 329.3 MB, max: 334.6 MB, 7.32 ± 0.58 times more than tsv)
  biome: 135.7 MB (min: 130.6 MB, max: 139.7 MB, 3.00 ± 0.25 times more than tsv)
  oxfmt: 215.6 MB (min: 206.9 MB, max: 227.5 MB, 4.77 ± 0.41 times more than tsv)
  tsv: 45.2 MB (min: 42.1 MB, max: 50.8 MB)

TypeScript-only (tsv-fair) benchmark complete!

=========================================
All benchmarks complete!
=========================================
```

<!-- BENCHMARK_RESULTS_END -->

## ❤ Who's [Sponsoring Oxc](https://github.com/sponsors/Boshen)?

<p align="center">
  <a href="https://github.com/sponsors/Boshen">
    <img src="https://raw.githubusercontent.com/Boshen/sponsors/main/sponsors.svg" alt="Our sponsors" />
  </a>
</p>
