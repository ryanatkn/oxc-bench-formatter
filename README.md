# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds three formatters, three scenarios, and a set of guards against silently unfair comparisons. Upstream's own scenarios are left as they were except where tsv competes in them, plus one lopsided width setting; the deviations are listed in [CLAUDE.md](CLAUDE.md).
>
> - **[tsv](https://tsv.fuz.dev)** is a native-Rust formatter for the JS/TS family, CSS, and Svelte. It's installed from npm like every other formatter here (`@fuzdev/tsv`'s platform package carries the binary); `TSV_BIN` benches a local build instead.
> - **It has no JSX/TSX parser**, so it runs only where the corpus is JSX-free: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only`, which benches Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set.
> - **`bench-svelte`** (also fork-added) puts tsv head-to-head with [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on ~2,230 third-party `.svelte` files, with rsvelte-fmt configured to tsv's fixed style, as every formatter in a tsv scenario is. rsvelte-fmt 0.7.x crashes nondeterministically (SIGABRT) on this corpus, so the scenario aborts more often than it completes — and an aborted run is published as-is, abort line included, rather than retried into a clean-looking result.
> - **`bench-tsv-delivery`** (also fork-added) answers a different question — what each way of _installing_ tsv costs. It benches the native binary against the same binary reached through [`@fuzdev/tsv`](https://www.npmjs.com/package/@fuzdev/tsv)'s Node dispatcher (how `npx tsv` runs it), and against [`@fuzdev/tsv_wasm`](https://www.npmjs.com/package/@fuzdev/tsv_wasm), the same CLI over a WASM engine in Node that platforms without a prebuilt binary fall back to. No other formatter appears in it, so its ratios only ever compare tsv to tsv.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions). Full methodology in [CLAUDE.md](CLAUDE.md).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [tsv](https://tsv.fuz.dev/)
- [tsv](https://tsv.fuz.dev/) through its npm dispatcher (`@fuzdev/tsv`'s `tsv` bin, delivery scenario only)
- [tsv](https://tsv.fuz.dev/) as WASM (`@fuzdev/tsv_wasm`, delivery scenario only)

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
node ./bench-tsv-delivery/bench.mjs
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
  - A `.svelte`-only snapshot of seven third-party sources: SvelteKit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake — copied from the [fuzdev/corpora](https://github.com/fuzdev/corpora) snapshot at one pinned commit (fork-added)
  - The same `parser.ts` once more, its own copy, for the tsv delivery comparison — one file, so every row is single-threaded and none gains from core count (fork-added)
- **Methodology**:
  - Multiple warmup runs before measurement
  - Multiple benchmark runs for statistical accuracy
  - Git reset before each run to ensure identical starting conditions
  - Memory usage measured using GNU time (peak RSS)
  - Local binaries via `./node_modules/.bin/`; tsv is the native binary inside `@fuzdev/tsv`'s platform package (or `TSV_BIN`), tsv-npm runs `node_modules/@fuzdev/tsv/bin.js` and tsv-wasm `node_modules/@fuzdev/tsv_wasm/cli.js`, both by path
  - tsv is non-configurable (width 100, tabs, single quotes, no trailing commas), so every formatter it is compared against is pinned to that same style — equal break decisions and equal output volume, at the cost of taking each tool off its own defaults
  - The tsv scenarios run a preflight parse check first — if any formatter rejects a file, that scenario aborts instead of timing a comparison the tools didn't run on the same work
  - That preflight also cross-checks scope: every formatter reporting a file count must report the same one, and every formatter must have at least one file to change — a mis-scoped tool that formats nothing would otherwise post an unbeatable time
  - A self-test (`pnpm run preflight-selftest`, also run before the suite) verifies that check can still read each formatter's diagnostics and counts, so the guard can't silently become a no-op after an upgrade
  - Each scenario prints the corpus commit (or the file's content hash) it ran against, since the cloned corpora track their upstream default branches
  - Memory ratios are taken against a fixed baseline per scenario (tsv where it runs, oxfmt elsewhere), not against whichever tool used least memory that run, so the column stays comparable across regenerations; a ratio below 1 means less than the baseline
  - A memory run that dies from a signal is never averaged in: the tsv scenarios abort on one (as their timed runs do, having no `--ignore-failure`), and the other scenarios exclude it and say so under the table

## Versions

- **Prettier**: 3.9.6
- **Biome**: 2.5.13
- **Oxfmt**: 0.68.0
- **rsvelte-fmt**: 0.7.11
- **tsv**: 0.3.0 (@fuzdev/tsv-linux-x64-gnu)
- **tsv_wasm**: 0.3.0

_Measured on: AMD Ryzen 5 PRO 7530U with Radeon Graphics · 12 threads · linux x64 — the ratios below depend on the core count._

## Results

<!-- BENCHMARK_RESULTS_START -->

```
=========================================
Benchmarking Large Single File
=========================================

Target: TypeScript compiler parser.ts (~540KB)
Corpus: 539588 bytes, sha256:dcddb577aa14
- 2 warmup runs, 5 benchmark runs
- Copy original before each run


Preflight (per-formatter parse check):
  prettier: clean (1 would change)
  prettier+oxc-parser: clean (1 would change)
  biome: clean (1 file, 1 would change)
  oxfmt: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      1.608 s ±  0.025 s    [User: 1.527 s, System: 0.885 s]
  Range (min … max):    1.573 s …  1.633 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     976.1 ms ±   4.0 ms    [User: 872.5 ms, System: 456.9 ms]
  Range (min … max):   971.1 ms … 982.2 ms    5 runs

Benchmark 3: biome
  Time (mean ± σ):     107.9 ms ±   1.6 ms    [User: 84.8 ms, System: 30.2 ms]
  Range (min … max):   105.6 ms … 110.0 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      62.0 ms ±   2.2 ms    [User: 36.4 ms, System: 58.5 ms]
  Range (min … max):    60.2 ms …  65.1 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      18.1 ms ±   0.9 ms    [User: 8.7 ms, System: 9.3 ms]
  Range (min … max):    17.0 ms …  19.6 ms    5 runs

Summary
  tsv ran
    3.43 ± 0.22 times faster than oxfmt
    5.97 ± 0.32 times faster than biome
   54.07 ± 2.82 times faster than prettier+oxc-parser
   89.10 ± 4.84 times faster than prettier

Memory Usage:
  prettier: 306.8 MB (min: 294.4 MB, max: 324.5 MB, 21.17 ± 1.57 times more than tsv)
  prettier+oxc-parser: 196.8 MB (min: 195.7 MB, max: 197.9 MB, 13.58 ± 0.84 times more than tsv)
  biome: 96.5 MB (min: 93.5 MB, max: 99.4 MB, 6.66 ± 0.45 times more than tsv)
  oxfmt: 114.1 MB (min: 113.9 MB, max: 114.2 MB, 7.87 ± 0.49 times more than tsv)
  tsv: 14.5 MB (min: 14.0 MB, max: 16.1 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.598 s ±  0.065 s    [User: 19.712 s, System: 1.420 s]
  Range (min … max):   11.500 s … 11.690 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.397 s ±  0.125 s    [User: 12.246 s, System: 0.728 s]
  Range (min … max):    9.271 s …  9.624 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     413.0 ms ±   1.6 ms    [User: 3146.3 ms, System: 291.8 ms]
  Range (min … max):   410.5 ms … 415.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     141.4 ms ±   2.2 ms    [User: 741.6 ms, System: 319.3 ms]
  Range (min … max):   139.4 ms … 145.5 ms    10 runs

Summary
  oxfmt ran
    2.92 ± 0.05 times faster than biome
   66.47 ± 1.35 times faster than prettier+oxc-parser
   82.04 ± 1.34 times faster than prettier

Memory Usage:
  prettier: 445.3 MB (min: 404.5 MB, max: 517.3 MB, 2.43 ± 0.20 times more than biome)
  prettier+oxc-parser: 323.3 MB (min: 310.1 MB, max: 346.2 MB, 1.77 ± 0.07 times more than biome)
  biome: 183.1 MB (min: 178.7 MB, max: 185.7 MB)
  oxfmt: 233.0 MB (min: 224.2 MB, max: 242.0 MB, 1.27 ± 0.04 times more than biome)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.663 s ±  0.274 s    [User: 57.467 s, System: 6.950 s]
  Range (min … max):   51.363 s … 51.899 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.800 s ±  0.141 s    [User: 79.665 s, System: 5.975 s]
  Range (min … max):    7.638 s …  7.885 s    3 runs

Summary
  oxfmt ran
    6.62 ± 0.12 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1660.9 MB (min: 1646.0 MB, max: 1680.1 MB, 3.99 ± 0.17 times more than oxfmt)
  oxfmt: 416.0 MB (min: 403.1 MB, max: 435.0 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.527 s ±  0.137 s    [User: 33.844 s, System: 2.158 s]
  Range (min … max):   25.426 s … 25.683 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.119 s ±  0.103 s    [User: 28.801 s, System: 3.254 s]
  Range (min … max):    3.001 s …  3.192 s    3 runs

Summary
  oxfmt ran
    8.18 ± 0.27 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 666.9 MB (min: 658.4 MB, max: 678.6 MB, 2.26 ± 0.11 times more than oxfmt)
  oxfmt: 294.8 MB (min: 283.0 MB, max: 310.3 MB)

Full features benchmark complete!


=========================================
Benchmarking TypeScript-only (non-JSX subset)
=========================================

Scope configs agree: .cjs .cts .js .mjs .mts .ts
Target: Outline repository (non-JSX JS/TS subset)
Corpus: 8cf997c 2026-07-14
- 2 warmup runs, 5 benchmark runs
- Git reset before each run
- .ts/.js/.mjs only: the common file set every formatter (incl. tsv) supports


Preflight (per-formatter parse check):
  prettier: clean (1644 would change)
  prettier+oxc-parser: clean (1644 would change)
  biome: clean (1648 files, 1644 would change)
  oxfmt: clean (1648 files, 1644 would change)
  tsv: clean (1648 files, 1644 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      8.259 s ±  0.046 s    [User: 13.884 s, System: 0.923 s]
  Range (min … max):    8.205 s …  8.300 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.853 s ±  0.074 s    [User: 8.807 s, System: 0.565 s]
  Range (min … max):    6.802 s …  6.982 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     304.0 ms ±   1.9 ms    [User: 2186.0 ms, System: 230.0 ms]
  Range (min … max):   302.2 ms … 306.1 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     119.3 ms ±   3.2 ms    [User: 508.5 ms, System: 269.4 ms]
  Range (min … max):   116.7 ms … 123.7 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      48.3 ms ±   0.4 ms    [User: 298.8 ms, System: 113.6 ms]
  Range (min … max):    47.7 ms …  48.7 ms    5 runs

Summary
  tsv ran
    2.47 ± 0.07 times faster than oxfmt
    6.30 ± 0.06 times faster than biome
  142.03 ± 1.90 times faster than prettier+oxc-parser
  171.17 ± 1.65 times faster than prettier

Memory Usage:
  prettier: 449.0 MB (min: 419.4 MB, max: 471.9 MB, 20.23 ± 1.18 times more than tsv)
  prettier+oxc-parser: 304.7 MB (min: 300.0 MB, max: 306.4 MB, 13.73 ± 0.51 times more than tsv)
  biome: 147.4 MB (min: 144.1 MB, max: 151.2 MB, 6.64 ± 0.27 times more than tsv)
  oxfmt: 224.9 MB (min: 217.2 MB, max: 230.4 MB, 10.13 ± 0.43 times more than tsv)
  tsv: 22.2 MB (min: 20.8 MB, max: 22.9 MB)

TypeScript-only (non-JSX subset) benchmark complete!


=========================================
Benchmarking Svelte (tsv vs rsvelte-fmt)
=========================================

Target: third-party .svelte corpus (kit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake)
Corpus: fuzdev/corpora@1117b4829309 (collections tree 5f40c547c3ed), snapshot 6214069 2026-09-04
- 2 warmup runs, 5 benchmark runs
- Git reset before each run
- .svelte only: the two Svelte-native formatters head-to-head


Preflight (per-formatter parse check):
  tsv: clean (2226 files, 2041 would change)
  rsvelte-fmt: CRASHED during check (exit 134)
  → rsvelte-fmt crashed partway through its check — its coverage is unknown and its timed runs may crash too
  → aborting: this scenario would not measure every formatter on the same work


=========================================
Benchmarking tsv Delivery Paths
=========================================

Target: TypeScript compiler parser.ts (~540KB), through each tsv distribution
Corpus: 539588 bytes, sha256:dcddb577aa14
- 2 warmup runs, 5 benchmark runs
- Copy original before each run


Preflight (per-formatter parse check):
  tsv-wasm: clean (1 file, 1 would change)
  tsv-npm: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: tsv-wasm
  Time (mean ± σ):     160.2 ms ±   2.8 ms    [User: 352.7 ms, System: 61.5 ms]
  Range (min … max):   155.6 ms … 163.2 ms    5 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      45.9 ms ±   0.6 ms    [User: 30.0 ms, System: 18.6 ms]
  Range (min … max):    45.3 ms …  46.8 ms    5 runs

Benchmark 3: tsv
  Time (mean ± σ):      18.3 ms ±   0.3 ms    [User: 10.0 ms, System: 8.3 ms]
  Range (min … max):    18.2 ms …  18.8 ms    5 runs

Summary
  tsv ran
    2.50 ± 0.05 times faster than tsv-npm
    8.74 ± 0.20 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 122.1 MB (min: 121.3 MB, max: 123.2 MB, 8.50 ± 0.51 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.5 MB, max: 49.7 MB, 3.46 ± 0.21 times more than tsv)
  tsv: 14.4 MB (min: 13.9 MB, max: 15.9 MB)

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
