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
- **tsv**: 0.1.0

## Results

<!-- BENCHMARK_RESULTS_START -->

```
=========================================
Benchmarking Large Single File
=========================================

Target: TypeScript compiler parser.ts (~540KB)
- 2 warmup runs, 5 benchmark runs
- Copy original before each run

Benchmark 1: prettier
  Time (mean ± σ):      1.585 s ±  0.025 s    [User: 1.517 s, System: 0.868 s]
  Range (min … max):    1.558 s …  1.612 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     515.6 ms ±   9.0 ms    [User: 751.5 ms, System: 117.5 ms]
  Range (min … max):   504.4 ms … 526.2 ms    5 runs

Benchmark 3: biome
  Time (mean ± σ):     137.1 ms ±   0.8 ms    [User: 108.4 ms, System: 37.6 ms]
  Range (min … max):   136.1 ms … 137.9 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     216.1 ms ±  21.7 ms    [User: 371.7 ms, System: 184.3 ms]
  Range (min … max):   189.8 ms … 243.8 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      23.5 ms ±   0.3 ms    [User: 11.4 ms, System: 12.0 ms]
  Range (min … max):    23.2 ms …  23.9 ms    5 runs

Summary
  tsv ran
    5.83 ± 0.08 times faster than biome
    9.20 ± 0.93 times faster than oxfmt
   21.94 ± 0.46 times faster than prettier+oxc-parser
   67.43 ± 1.31 times faster than prettier

Memory Usage:
  prettier: 303.5 MB (min: 291.1 MB, max: 310.9 MB)
  prettier+oxc-parser: 184.8 MB (min: 184.2 MB, max: 186.7 MB)
  biome: 102.1 MB (min: 101.8 MB, max: 102.4 MB)
  oxfmt: 118.4 MB (min: 118.3 MB, max: 118.7 MB)
  tsv: 22.6 MB (min: 22.3 MB, max: 23.4 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     12.168 s ±  0.091 s    [User: 20.561 s, System: 1.346 s]
  Range (min … max):   12.029 s … 12.325 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.966 s ±  0.085 s    [User: 13.239 s, System: 0.784 s]
  Range (min … max):    9.816 s … 10.117 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     498.7 ms ±   3.9 ms    [User: 4506.2 ms, System: 509.7 ms]
  Range (min … max):   494.7 ms … 505.3 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     296.9 ms ±  11.3 ms    [User: 1123.3 ms, System: 483.0 ms]
  Range (min … max):   278.9 ms … 312.0 ms    10 runs

Summary
  oxfmt ran
    1.68 ± 0.07 times faster than biome
   33.57 ± 1.31 times faster than prettier+oxc-parser
   40.99 ± 1.59 times faster than prettier

Memory Usage:
  prettier: 449.8 MB (min: 386.6 MB, max: 507.4 MB)
  prettier+oxc-parser: 339.4 MB (min: 325.1 MB, max: 368.1 MB)
  biome: 141.1 MB (min: 132.2 MB, max: 146.5 MB)
  oxfmt: 236.3 MB (min: 227.3 MB, max: 246.1 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     46.749 s ±  0.399 s    [User: 56.919 s, System: 2.680 s]
  Range (min … max):   46.382 s … 47.174 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      8.179 s ±  0.085 s    [User: 87.293 s, System: 6.081 s]
  Range (min … max):    8.092 s …  8.262 s    3 runs

Summary
  oxfmt ran
    5.72 ± 0.08 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1272.1 MB (min: 1209.8 MB, max: 1395.3 MB)
  oxfmt: 406.9 MB (min: 376.7 MB, max: 439.2 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.790 s ±  0.112 s    [User: 34.632 s, System: 1.998 s]
  Range (min … max):   25.663 s … 25.876 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.416 s ±  0.049 s    [User: 31.761 s, System: 3.113 s]
  Range (min … max):    3.367 s …  3.465 s    3 runs

Summary
  oxfmt ran
    7.55 ± 0.11 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 675.2 MB (min: 658.8 MB, max: 689.6 MB)
  oxfmt: 309.1 MB (min: 299.9 MB, max: 315.6 MB)

Full features benchmark complete!


=========================================
Benchmarking TypeScript-only (tsv-fair)
=========================================

Target: .ts harvested from the fuz-ecosystem src/ (tsv corpus subset)
- 2 warmup runs, 5 benchmark runs
- Git reset before each run
- .ts only: the common file set every formatter (incl. tsv) supports

Benchmark 1: prettier
  Time (mean ± σ):     13.481 s ±  0.146 s    [User: 22.534 s, System: 1.269 s]
  Range (min … max):   13.352 s … 13.699 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     11.477 s ±  0.119 s    [User: 15.532 s, System: 0.847 s]
  Range (min … max):   11.295 s … 11.577 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     560.7 ms ±  11.2 ms    [User: 5251.6 ms, System: 425.2 ms]
  Range (min … max):   550.3 ms … 579.8 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     321.3 ms ±   7.5 ms    [User: 1343.0 ms, System: 463.1 ms]
  Range (min … max):   314.6 ms … 330.8 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      96.5 ms ±   1.3 ms    [User: 756.0 ms, System: 184.7 ms]
  Range (min … max):    94.7 ms …  97.6 ms    5 runs

Summary
  tsv ran
    3.33 ± 0.09 times faster than oxfmt
    5.81 ± 0.14 times faster than biome
  118.88 ± 1.99 times faster than prettier+oxc-parser
  139.64 ± 2.38 times faster than prettier

Memory Usage:
  prettier: 443.3 MB (min: 425.3 MB, max: 477.1 MB)
  prettier+oxc-parser: 351.1 MB (min: 331.6 MB, max: 380.9 MB)
  biome: 156.3 MB (min: 150.3 MB, max: 162.2 MB)
  oxfmt: 254.9 MB (min: 249.1 MB, max: 261.6 MB)
  tsv: 44.5 MB (min: 42.2 MB, max: 45.9 MB)

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
