# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds three formatters, three scenarios, and a set of guards against silently unfair comparisons. Upstream's own scenarios are left as they were except where tsv competes in them, plus one lopsided width setting; the deviations are listed in [CLAUDE.md](CLAUDE.md).
>
> - **[tsv](https://tsv.fuz.dev)** is a native-Rust formatter for the JS/TS family, CSS, and Svelte. It's installed from npm like every other formatter here (`@fuzdev/tsv`'s platform package carries the binary); `TSV_BIN` benches a local build instead.
> - **It has no JSX/TSX parser**, so it runs only where the corpus is JSX-free: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only`, which benches Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set.
> - **`bench-svelte`** (also fork-added) puts tsv head-to-head with [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on ~2,230 third-party `.svelte` files, with rsvelte-fmt configured to tsv's fixed style, as every formatter in a tsv scenario is. rsvelte-fmt 0.7.x crashes nondeterministically (SIGABRT) on this corpus, so the scenario aborts more often than it completes — and an aborted run is published as-is, abort line included, rather than retried into a clean-looking result.
> - **`bench-tsv-delivery`** (also fork-added) answers a different question — what each way of _installing_ tsv costs. It benches the native binary against the same binary reached through [`@fuzdev/tsv`](https://www.npmjs.com/package/@fuzdev/tsv)'s Node dispatcher (how `npx tsv` runs it), and against [`@fuzdev/tsv-wasm`](https://www.npmjs.com/package/@fuzdev/tsv-wasm), the same CLI over a WASM engine in Node that platforms without a prebuilt binary fall back to. No other formatter appears in it, so its ratios only ever compare tsv to tsv.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions). Full methodology in [CLAUDE.md](CLAUDE.md).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [tsv](https://tsv.fuz.dev/)
- [tsv](https://tsv.fuz.dev/) through its npm dispatcher (`@fuzdev/tsv`'s `tsv` bin, delivery scenario only)
- [tsv](https://tsv.fuz.dev/) as WASM (`@fuzdev/tsv-wasm`, delivery scenario only)

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
  - Local binaries via `./node_modules/.bin/`; tsv is the native binary inside `@fuzdev/tsv`'s platform package (or `TSV_BIN`), tsv-npm runs `node_modules/@fuzdev/tsv/bin.js` and tsv-wasm `node_modules/@fuzdev/tsv-wasm/cli.js`, both by path
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
- **tsv-wasm**: 0.3.0

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
  Time (mean ± σ):      1.585 s ±  0.028 s    [User: 1.551 s, System: 0.839 s]
  Range (min … max):    1.560 s …  1.628 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     970.9 ms ±   2.9 ms    [User: 874.5 ms, System: 449.3 ms]
  Range (min … max):   967.6 ms … 974.9 ms    5 runs

Benchmark 3: biome
  Time (mean ± σ):     108.8 ms ±   0.8 ms    [User: 92.2 ms, System: 24.0 ms]
  Range (min … max):   107.7 ms … 109.7 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      62.0 ms ±   1.1 ms    [User: 37.5 ms, System: 56.2 ms]
  Range (min … max):    61.2 ms …  63.8 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      18.4 ms ±   0.4 ms    [User: 10.5 ms, System: 7.8 ms]
  Range (min … max):    17.9 ms …  18.8 ms    5 runs

Summary
  tsv ran
    3.37 ± 0.09 times faster than oxfmt
    5.91 ± 0.14 times faster than biome
   52.80 ± 1.18 times faster than prettier+oxc-parser
   86.21 ± 2.46 times faster than prettier

Memory Usage:
  prettier: 301.6 MB (min: 294.0 MB, max: 312.1 MB, 21.27 ± 0.55 times more than tsv)
  prettier+oxc-parser: 197.1 MB (min: 194.8 MB, max: 198.5 MB, 13.90 ± 0.17 times more than tsv)
  biome: 94.7 MB (min: 93.6 MB, max: 96.7 MB, 6.68 ± 0.11 times more than tsv)
  oxfmt: 113.7 MB (min: 112.0 MB, max: 114.3 MB, 8.02 ± 0.11 times more than tsv)
  tsv: 14.2 MB (min: 13.9 MB, max: 14.3 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     12.001 s ±  0.111 s    [User: 20.186 s, System: 1.427 s]
  Range (min … max):   11.785 s … 12.142 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.623 s ±  0.189 s    [User: 12.530 s, System: 0.723 s]
  Range (min … max):    9.367 s …  9.954 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     414.8 ms ±   2.1 ms    [User: 3159.7 ms, System: 305.0 ms]
  Range (min … max):   410.8 ms … 417.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     141.0 ms ±   2.8 ms    [User: 735.8 ms, System: 304.5 ms]
  Range (min … max):   137.2 ms … 145.5 ms    10 runs

Summary
  oxfmt ran
    2.94 ± 0.06 times faster than biome
   68.23 ± 1.89 times faster than prettier+oxc-parser
   85.09 ± 1.84 times faster than prettier

Memory Usage:
  prettier: 457.8 MB (min: 393.0 MB, max: 529.5 MB, 1.98 ± 0.17 times more than oxfmt)
  prettier+oxc-parser: 337.9 MB (min: 306.8 MB, max: 445.7 MB, 1.47 ± 0.18 times more than oxfmt)
  biome: 183.6 MB (min: 178.9 MB, max: 187.7 MB, 0.80 ± 0.03 times more than oxfmt)
  oxfmt: 230.7 MB (min: 219.7 MB, max: 244.6 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     52.253 s ±  0.477 s    [User: 58.105 s, System: 6.838 s]
  Range (min … max):   51.760 s … 52.713 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      8.244 s ±  0.398 s    [User: 83.385 s, System: 5.827 s]
  Range (min … max):    7.911 s …  8.684 s    3 runs

Summary
  oxfmt ran
    6.34 ± 0.31 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1746.0 MB (min: 1727.0 MB, max: 1757.2 MB, 4.32 ± 0.09 times more than oxfmt)
  oxfmt: 403.8 MB (min: 396.9 MB, max: 412.5 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.919 s ±  0.097 s    [User: 34.201 s, System: 2.151 s]
  Range (min … max):   25.813 s … 26.003 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.077 s ±  0.073 s    [User: 29.986 s, System: 3.104 s]
  Range (min … max):    2.995 s …  3.136 s    3 runs

Summary
  oxfmt ran
    8.42 ± 0.20 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 688.7 MB (min: 647.7 MB, max: 756.3 MB, 2.22 ± 0.21 times more than oxfmt)
  oxfmt: 310.0 MB (min: 298.2 MB, max: 321.6 MB)

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
  Time (mean ± σ):      8.482 s ±  0.070 s    [User: 13.997 s, System: 0.946 s]
  Range (min … max):    8.389 s …  8.585 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.862 s ±  0.125 s    [User: 8.791 s, System: 0.573 s]
  Range (min … max):    6.748 s …  7.015 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     303.9 ms ±   3.2 ms    [User: 2199.2 ms, System: 218.8 ms]
  Range (min … max):   300.4 ms … 309.0 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     119.2 ms ±   3.4 ms    [User: 521.1 ms, System: 262.1 ms]
  Range (min … max):   114.0 ms … 122.4 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      48.3 ms ±   0.4 ms    [User: 297.2 ms, System: 115.9 ms]
  Range (min … max):    47.8 ms …  48.7 ms    5 runs

Summary
  tsv ran
    2.47 ± 0.07 times faster than oxfmt
    6.29 ± 0.08 times faster than biome
  142.03 ± 2.78 times faster than prettier+oxc-parser
  175.56 ± 1.93 times faster than prettier

Memory Usage:
  prettier: 433.0 MB (min: 375.5 MB, max: 474.0 MB, 19.74 ± 1.90 times more than tsv)
  prettier+oxc-parser: 310.7 MB (min: 302.2 MB, max: 327.1 MB, 14.17 ± 0.49 times more than tsv)
  biome: 144.7 MB (min: 142.6 MB, max: 147.9 MB, 6.60 ± 0.14 times more than tsv)
  oxfmt: 229.7 MB (min: 221.4 MB, max: 235.5 MB, 10.47 ± 0.30 times more than tsv)
  tsv: 21.9 MB (min: 21.7 MB, max: 22.3 MB)

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
  rsvelte-fmt: clean (2226 files, 2023 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: tsv
  Time (mean ± σ):      43.3 ms ±   0.2 ms    [User: 240.6 ms, System: 134.0 ms]
  Range (min … max):    43.1 ms …  43.7 ms    5 runs

Benchmark 2: rsvelte-fmt
  Time (mean ± σ):     184.3 ms ±   8.1 ms    [User: 760.0 ms, System: 706.9 ms]
  Range (min … max):   174.0 ms … 193.6 ms    5 runs

Summary
  tsv ran
    4.26 ± 0.19 times faster than rsvelte-fmt

Memory Usage:
  tsv: 15.0 MB (min: 14.3 MB, max: 15.8 MB)
  rsvelte-fmt: 137.2 MB (min: 132.6 MB, max: 145.1 MB, 9.17 ± 0.49 times more than tsv)

Svelte benchmark complete!


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
  Time (mean ± σ):     162.3 ms ±   1.6 ms    [User: 358.1 ms, System: 60.9 ms]
  Range (min … max):   160.8 ms … 164.5 ms    5 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      46.0 ms ±   0.6 ms    [User: 25.8 ms, System: 22.4 ms]
  Range (min … max):    45.4 ms …  46.9 ms    5 runs

Benchmark 3: tsv
  Time (mean ± σ):      18.2 ms ±   0.6 ms    [User: 9.9 ms, System: 8.3 ms]
  Range (min … max):    17.2 ms …  18.7 ms    5 runs

Summary
  tsv ran
    2.52 ± 0.09 times faster than tsv-npm
    8.90 ± 0.30 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 121.0 MB (min: 118.1 MB, max: 122.6 MB, 8.55 ± 0.15 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.4 MB, max: 49.8 MB, 3.51 ± 0.04 times more than tsv)
  tsv: 14.1 MB (min: 14.0 MB, max: 14.4 MB)

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
