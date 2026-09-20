# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds [tsv](https://tsv.fuz.dev) — a native-Rust formatter for the JS/TS family, CSS, and Svelte — plus three scenarios and a set of guards against silently unfair comparisons. Changes to upstream's own scenarios are small, except `bench-large-single-file`, which gains the tsv rows and those guards; [CLAUDE.md](CLAUDE.md) lists every deviation and the full methodology.
>
> - **tsv has no JSX/TSX parser**, so it runs only on JSX-free corpora: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only` (Outline's `.ts`/`.js`/`.mjs` files, every formatter scoped to that same set) and `bench-svelte`, plus the tsv-only `bench-tsv-delivery`.
> - **`bench-svelte`** puts tsv against [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on 2,226 third-party `.svelte` files. rsvelte-fmt 0.7.x crashes nondeterministically (SIGABRT) on the check pass this scenario's preflight runs, so about two runs in three abort before timing anything — and an aborted run is published as-is, abort line included, rather than retried into a clean-looking result.
> - **`bench-tsv-delivery`** asks a different question — what each way of _installing_ tsv costs — so only tsv's own rows appear in it.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [tsv](https://tsv.fuz.dev/), as up to three rows — one per way of running it:

| Row        | What is timed                                                                                                                                                   | Scenarios                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `tsv`      | the native binary, run directly                                                                                                                                 | every tsv scenario        |
| `tsv-npm`  | the same binary, started the way an npm install starts it (`npx tsv`, a `package.json` script): `@fuzdev/tsv`'s `tsv` bin, a Node script that spawns the binary | every tsv scenario        |
| `tsv-wasm` | the same CLI over a WASM engine in Node (`@fuzdev/tsv-wasm`) — the fallback on platforms with no prebuilt binary                                                | `bench-tsv-delivery` only |

`tsv` and `tsv-npm` do identical formatting work in the same binary. The only
difference is the launch in front of `tsv-npm`, a fixed ~30 ms in the results
below whatever the corpus — most of a single-file run, a shrinking share of a
multi-file one. Timed layer by layer on this machine, that is ~20 ms of Node
starting, ~10 ms of the dispatcher loading its modules and spawning the binary,
and ~3 ms of pnpm's `.bin/` shell shim; the binary's own start is under 1 ms.

**Read `tsv-npm` against the other formatters.** They are all timed through
their npm bins, which start Node first too (Biome's and rsvelte-fmt's then spawn
a native binary, exactly `tsv-npm`'s shape), so it is the like-for-like row.
`tsv` is the engine's own cost, and the fixed baseline the memory ratios are
taken against. `tsv-npm`'s memory row is its Node launcher (~50 MB), not tsv —
see the memory note under [Benchmark Details](#benchmark-details).

## Run

```bash
# One-time setup (dependencies + test corpora) — the only step that uses the network
pnpm run setup   # ./init.sh

# Run all benchmarks
pnpm run bench

# Or one scenario at a time
node ./bench-large-single-file/bench.mjs
node ./bench-js-no-embedded/bench.mjs
node ./bench-mixed-embedded/bench.mjs
node ./bench-full-features/bench.mjs
node ./bench-ts-only/bench.mjs
node ./bench-svelte/bench.mjs
node ./bench-tsv-delivery/bench.mjs
```

Offline, run `node bench-all.mjs` (or `node bench-all-and-update-readme.mjs`)
instead of `pnpm run …`: when the installed pnpm doesn't match the
`packageManager` pin, pnpm tries to fetch the pinned version on every invocation
and stalls for a minute before the script starts.

`pnpm run update-readme` runs everything and publishes it twice: the console
output into [Results](#results) below, and the same run as data in
[`results.json`](results.json) — one record per scenario (the corpus revision it
ran on, timings from hyperfine's own export rather than scraped text, the memory
and preflight rows),
the versions and machine, and `node_startup`, a bare `node -e ""` timed the same
way (the launch floor every npm-bin row pays).

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
  - 2,226 `.svelte` files from seven third-party sources (SvelteKit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake), read from [fuzdev/corpora](https://github.com/fuzdev/corpora) at a pinned commit (fork-added)
  - `parser.ts` again for the tsv delivery comparison — one file, so every row is single-threaded (fork-added)
- **Methodology**:
  - Multiple warmup runs before measurement
  - Multiple benchmark runs for statistical accuracy
  - Git reset before each run to ensure identical starting conditions
  - Memory usage measured using GNU time (peak RSS)
  - Local binaries via `./node_modules/.bin/`
- **Methodology added by this fork**:
  - tsv is the native binary inside `@fuzdev/tsv`'s platform package (or `TSV_BIN`, for a local build), not a `.bin/` entry. `tsv-npm` and `tsv-wasm` run through bin shims the harness copies from pnpm's own — both packages claim the `tsv` bin name and pnpm links only one — so they pay the same ~3 ms shell shim as every other `.bin/` row. That levels `tsv-npm` with the other npm-bin rows; it is a tenth of the gap between `tsv-npm` and `tsv`, not the explanation for it
  - tsv is non-configurable (width 100, tabs, single quotes, no trailing commas), so every formatter compared against it is pinned to that style: equal break decisions and equal output volume, at the cost of taking each tool off its defaults
  - The tsv scenarios run a preflight check first and abort rather than time an unequal comparison: if any formatter rejects a file, if the file counts the formatters report differ, if one has nothing to change (a mis-scoped tool that formats nothing would post an unbeatable time), or if a formatter's check crashes or can't be read at all. A self-test (`pnpm run preflight-selftest`, also run before the suite) verifies preflight can still read each formatter's output, so an upgrade can't silently turn the guard into a no-op
  - hyperfine runs the formatters in the order listed, never interleaved, so on a machine that throttles, later rows run warmer. The tsv scenarios idle 10 s before each formatter to narrow that drift; tsv runs last in them, so what remains biases against it
  - Peak RSS is the largest single process in a command's tree, not the sum, so a Node launcher and the native binary it spawns are never added together: Biome's and rsvelte-fmt's rows are their binary without the ~45 MB launcher, and tsv-npm's row _is_ its launcher, whatever tsv uses under it
  - Memory ratios are taken against a fixed baseline per scenario (tsv where it runs, oxfmt elsewhere), not that run's smallest, so the column stays comparable across regenerations; a ratio below 1 means less than the baseline
  - A memory run that dies from a signal is never averaged in: the tsv scenarios abort on one (as their timed runs do, having no `--ignore-failure`), and the other scenarios exclude it and say so under the table
  - Each scenario prints the corpus commit (or the file's content hash) it ran against — in the block below and in `results.json` — since the cloned corpora track their upstream default branches

## Versions

- **Prettier**: 3.9.6
- **Biome**: 2.5.13
- **Oxfmt**: 0.68.0
- **rsvelte-fmt**: 0.7.23
- **tsv**: 0.4.1 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.4.1
- **Node**: 24.14.1

_Measured on: AMD Ryzen 5 PRO 7530U with Radeon Graphics · 12 threads · linux x64 — the ratios below depend on the core count._

## Results

<!-- BENCHMARK_RESULTS_START -->

```
=========================================
Benchmarking Large Single File
=========================================

Target: TypeScript compiler parser.ts (~540KB)
Corpus: 539588 bytes, sha256:dcddb577aa14
- 3 warmup runs, 20 benchmark runs, 10s settle before each formatter
- Copy original before each run


Preflight (per-formatter parse check):
  prettier: clean (1 would change)
  prettier+oxc-parser: clean (1 would change)
  biome: clean (1 file, 1 would change)
  oxfmt: clean (1 file, 1 would change)
  tsv-npm: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      1.606 s ±  0.032 s    [User: 1.540 s, System: 0.869 s]
  Range (min … max):    1.545 s …  1.666 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     972.9 ms ±  11.4 ms    [User: 873.6 ms, System: 455.4 ms]
  Range (min … max):   947.4 ms … 994.0 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     107.9 ms ±   1.2 ms    [User: 82.4 ms, System: 32.8 ms]
  Range (min … max):   106.3 ms … 110.4 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      62.2 ms ±   2.0 ms    [User: 42.7 ms, System: 52.3 ms]
  Range (min … max):    59.6 ms …  66.0 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.9 ms ±   1.0 ms    [User: 31.1 ms, System: 18.2 ms]
  Range (min … max):    45.3 ms …  48.9 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.6 ms ±   0.3 ms    [User: 11.1 ms, System: 5.5 ms]
  Range (min … max):    16.0 ms …  17.2 ms    20 runs

Summary
  tsv ran
    2.82 ± 0.08 times faster than tsv-npm
    3.75 ± 0.14 times faster than oxfmt
    6.50 ± 0.15 times faster than biome
   58.61 ± 1.41 times faster than prettier+oxc-parser
   96.74 ± 2.82 times faster than prettier

Memory Usage:
  prettier: 305.4 MB (min: 292.8 MB, max: 321.7 MB, 22.75 ± 0.66 times more than tsv)
  prettier+oxc-parser: 196.6 MB (min: 193.8 MB, max: 199.3 MB, 14.64 ± 0.23 times more than tsv)
  biome: 95.2 MB (min: 92.7 MB, max: 99.5 MB, 7.09 ± 0.17 times more than tsv)
  oxfmt: 114.0 MB (min: 113.9 MB, max: 114.2 MB, 8.49 ± 0.11 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.5 MB, max: 49.8 MB, 3.69 ± 0.05 times more than tsv)
  tsv: 13.4 MB (min: 13.1 MB, max: 13.8 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.864 s ±  0.189 s    [User: 20.104 s, System: 1.413 s]
  Range (min … max):   11.565 s … 12.146 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.500 s ±  0.117 s    [User: 12.289 s, System: 0.723 s]
  Range (min … max):    9.361 s …  9.709 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     414.0 ms ±   4.1 ms    [User: 3143.1 ms, System: 288.6 ms]
  Range (min … max):   410.2 ms … 423.9 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     141.7 ms ±   2.8 ms    [User: 759.1 ms, System: 292.4 ms]
  Range (min … max):   138.2 ms … 147.3 ms    10 runs

Summary
  oxfmt ran
    2.92 ± 0.06 times faster than biome
   67.02 ± 1.55 times faster than prettier+oxc-parser
   83.70 ± 2.11 times faster than prettier

Memory Usage:
  prettier: 463.5 MB (min: 415.4 MB, max: 503.8 MB, 2.01 ± 0.15 times more than oxfmt)
  prettier+oxc-parser: 320.5 MB (min: 306.5 MB, max: 346.0 MB, 1.39 ± 0.07 times more than oxfmt)
  biome: 182.5 MB (min: 179.4 MB, max: 183.7 MB, 0.79 ± 0.02 times more than oxfmt)
  oxfmt: 230.3 MB (min: 217.9 MB, max: 240.1 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     52.222 s ±  0.658 s    [User: 58.139 s, System: 6.898 s]
  Range (min … max):   51.595 s … 52.906 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.840 s ±  0.298 s    [User: 80.523 s, System: 5.671 s]
  Range (min … max):    7.600 s …  8.174 s    3 runs

Summary
  oxfmt ran
    6.66 ± 0.27 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1706.4 MB (min: 1680.0 MB, max: 1744.8 MB, 4.12 ± 0.20 times more than oxfmt)
  oxfmt: 414.2 MB (min: 395.0 MB, max: 432.5 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.763 s ±  0.246 s    [User: 34.017 s, System: 2.266 s]
  Range (min … max):   25.498 s … 25.982 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.180 s ±  0.167 s    [User: 30.191 s, System: 3.063 s]
  Range (min … max):    3.007 s …  3.339 s    3 runs

Summary
  oxfmt ran
    8.10 ± 0.43 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 649.4 MB (min: 638.2 MB, max: 660.6 MB, 2.11 ± 0.06 times more than oxfmt)
  oxfmt: 308.3 MB (min: 301.7 MB, max: 316.9 MB)

Full features benchmark complete!


=========================================
Benchmarking TypeScript-only (non-JSX subset)
=========================================

Scope configs agree: .cjs .cts .js .mjs .mts .ts
Target: Outline repository (non-JSX JS/TS subset)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs, 10s settle before each formatter
- Git reset before each run
- .ts/.js/.mjs only: the common file set every formatter (incl. tsv) supports


Preflight (per-formatter parse check):
  prettier: clean (1644 would change)
  prettier+oxc-parser: clean (1644 would change)
  biome: clean (1648 files, 1644 would change)
  oxfmt: clean (1648 files, 1644 would change)
  tsv-npm: clean (1648 files, 1644 would change)
  tsv: clean (1648 files, 1644 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      8.321 s ±  0.100 s    [User: 13.814 s, System: 0.952 s]
  Range (min … max):    8.188 s …  8.506 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.863 s ±  0.079 s    [User: 8.809 s, System: 0.579 s]
  Range (min … max):    6.727 s …  6.993 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     300.7 ms ±   1.5 ms    [User: 2182.8 ms, System: 218.7 ms]
  Range (min … max):   299.0 ms … 303.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     116.7 ms ±   3.2 ms    [User: 534.6 ms, System: 268.3 ms]
  Range (min … max):   113.8 ms … 123.6 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      75.8 ms ±   0.5 ms    [User: 289.2 ms, System: 130.7 ms]
  Range (min … max):    75.2 ms …  76.6 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      45.3 ms ±   0.4 ms    [User: 272.6 ms, System: 114.0 ms]
  Range (min … max):    44.9 ms …  46.0 ms    10 runs

Summary
  tsv ran
    1.67 ± 0.02 times faster than tsv-npm
    2.58 ± 0.07 times faster than oxfmt
    6.64 ± 0.06 times faster than biome
  151.55 ± 2.13 times faster than prettier+oxc-parser
  183.74 ± 2.66 times faster than prettier

Memory Usage:
  prettier: 436.4 MB (min: 360.5 MB, max: 482.9 MB, 20.90 ± 1.92 times more than tsv)
  prettier+oxc-parser: 306.6 MB (min: 300.5 MB, max: 324.4 MB, 14.68 ± 0.40 times more than tsv)
  biome: 145.6 MB (min: 141.5 MB, max: 149.5 MB, 6.97 ± 0.18 times more than tsv)
  oxfmt: 227.1 MB (min: 214.1 MB, max: 235.1 MB, 10.87 ± 0.39 times more than tsv)
  tsv-npm: 49.4 MB (min: 47.6 MB, max: 49.9 MB, 2.37 ± 0.05 times more than tsv)
  tsv: 20.9 MB (min: 20.4 MB, max: 21.5 MB)

TypeScript-only (non-JSX subset) benchmark complete!


=========================================
Benchmarking Svelte (tsv vs rsvelte-fmt)
=========================================

Target: third-party .svelte corpus (kit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake)
Corpus: fuzdev/corpora@1117b4829309 (collections tree 5f40c547c3ed), snapshot 6214069 2026-09-04
- 3 warmup runs, 10 benchmark runs, 10s settle before each formatter
- Git reset before each run
- .svelte only: the two Svelte-native formatters head-to-head


Preflight (per-formatter parse check):
  rsvelte-fmt: clean (2226 files, 2023 would change)
  tsv-npm: clean (2226 files, 2041 would change)
  tsv: clean (2226 files, 2041 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: rsvelte-fmt
  Time (mean ± σ):     190.9 ms ±   7.1 ms    [User: 833.2 ms, System: 697.6 ms]
  Range (min … max):   180.6 ms … 201.4 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      72.1 ms ±   0.6 ms    [User: 253.4 ms, System: 137.2 ms]
  Range (min … max):    71.1 ms …  72.7 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      40.8 ms ±   0.3 ms    [User: 227.6 ms, System: 125.1 ms]
  Range (min … max):    40.2 ms …  41.5 ms    10 runs

Summary
  tsv ran
    1.77 ± 0.02 times faster than tsv-npm
    4.67 ± 0.18 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 137.3 MB (min: 121.1 MB, max: 153.6 MB, 10.53 ± 0.68 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.3 MB, max: 49.7 MB, 3.80 ± 0.07 times more than tsv)
  tsv: 13.0 MB (min: 12.6 MB, max: 13.3 MB)

Svelte benchmark complete!


=========================================
Benchmarking tsv Delivery Paths
=========================================

Target: TypeScript compiler parser.ts (~540KB), through each tsv distribution
Corpus: 539588 bytes, sha256:dcddb577aa14
- 3 warmup runs, 20 benchmark runs, 10s settle before each formatter
- Copy original before each run


Preflight (per-formatter parse check):
  tsv-wasm: clean (1 file, 1 would change)
  tsv-npm: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: tsv-wasm
  Time (mean ± σ):     150.6 ms ±   2.3 ms    [User: 325.2 ms, System: 53.3 ms]
  Range (min … max):   147.2 ms … 155.6 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      47.5 ms ±   0.9 ms    [User: 27.6 ms, System: 22.2 ms]
  Range (min … max):    45.8 ms …  49.5 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      17.1 ms ±   0.4 ms    [User: 10.9 ms, System: 6.1 ms]
  Range (min … max):    16.5 ms …  18.0 ms    20 runs

Summary
  tsv ran
    2.79 ± 0.08 times faster than tsv-npm
    8.82 ± 0.23 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 117.4 MB (min: 112.7 MB, max: 120.1 MB, 8.78 ± 0.16 times more than tsv)
  tsv-npm: 49.4 MB (min: 47.6 MB, max: 49.7 MB, 3.70 ± 0.05 times more than tsv)
  tsv: 13.4 MB (min: 13.1 MB, max: 13.6 MB)

tsv delivery benchmark complete!

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
