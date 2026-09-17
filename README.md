# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds three formatters, three scenarios, and a set of guards against silently unfair comparisons. Upstream's own scenarios are left as they were except where tsv competes in them, plus one lopsided width setting; the deviations are listed in [CLAUDE.md](CLAUDE.md).
>
> - **[tsv](https://tsv.fuz.dev)** is a native-Rust formatter for the JS/TS family, CSS, and Svelte. It's installed from npm like every other formatter here (`@fuzdev/tsv`'s platform package carries the binary); `TSV_BIN` benches a local build instead.
> - **It has no JSX/TSX parser**, so it runs only where the corpus is JSX-free: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only`, which benches Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set.
> - **tsv has two rows wherever it faces another formatter.** `tsv` is the bare native binary; `tsv-npm` is that same binary through `@fuzdev/tsv`'s Node dispatcher, how `npx tsv` runs it. Prettier, Biome, Oxfmt and rsvelte-fmt are all timed through their npm bins, which start Node first (Biome's and rsvelte-fmt's then launch a native binary, as tsv's dispatcher does), so `tsv-npm` is the like-for-like row against them and `tsv` is what the binary costs on its own. Ratios are still taken against `tsv`.
> - **`bench-svelte`** (also fork-added) puts tsv head-to-head with [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on ~2,230 third-party `.svelte` files, with rsvelte-fmt configured to tsv's fixed style, as every formatter in a tsv scenario is. rsvelte-fmt 0.7.x crashes nondeterministically (SIGABRT) on the check pass this scenario's preflight runs, so about two runs in three abort before timing anything — and an aborted run is published as-is, abort line included, rather than retried into a clean-looking result.
> - **`bench-tsv-delivery`** (also fork-added) answers a different question — what each way of _installing_ tsv costs. It benches the native binary against the same binary reached through [`@fuzdev/tsv`](https://www.npmjs.com/package/@fuzdev/tsv)'s Node dispatcher (how `npx tsv` runs it), and against [`@fuzdev/tsv-wasm`](https://www.npmjs.com/package/@fuzdev/tsv-wasm), the same CLI over a WASM engine in Node that platforms without a prebuilt binary fall back to. No other formatter appears in it, so its ratios only ever compare tsv to tsv.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions). Full methodology in [CLAUDE.md](CLAUDE.md).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [tsv](https://tsv.fuz.dev/)
- [tsv](https://tsv.fuz.dev/) through its npm dispatcher (`@fuzdev/tsv`'s `tsv` bin — beside native tsv in every scenario tsv runs in)
- [tsv](https://tsv.fuz.dev/) as WASM (`@fuzdev/tsv-wasm`, delivery scenario only)

## Run

```bash
# One-time setup: dependencies and the test corpora.
# This is the only step that needs the network — the benchmarks themselves
# read nothing but local files, so the machine can be offline for them.
pnpm run setup   # ./init.sh

# Run all benchmarks
pnpm run bench   # or, offline: node bench-all.mjs (see "Running disconnected")

# Or one scenario at a time
node ./bench-large-single-file/bench.mjs
node ./bench-js-no-embedded/bench.mjs
node ./bench-mixed-embedded/bench.mjs
node ./bench-full-features/bench.mjs
node ./bench-ts-only/bench.mjs
node ./bench-svelte/bench.mjs
node ./bench-tsv-delivery/bench.mjs
```

Running disconnected: the benchmarks themselves need no network, but `pnpm run`
does if your globally installed pnpm doesn't match the `packageManager` pin in
`package.json` — pnpm fetches the pinned version on every invocation in this
repo, which offline stalls for a minute before the script starts. Either match
that version or call the scripts directly (`node bench-all.mjs`,
`node bench-all-and-update-readme.mjs`).

`pnpm run update-readme` runs everything and publishes it twice: the console
output into [Results](#results) below, and the same run as data in
[`results.json`](results.json) — hyperfine's own export at full precision, the
memory table, and the preflight rows, with the versions and machine listed under
[Versions](#versions).

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
  - Memory usage measured using GNU time (peak RSS) — the largest single process in each command's tree, not the sum, so a Node launcher and the native binary it spawns (Biome, rsvelte-fmt, tsv-npm) are not added together: Biome's and rsvelte-fmt's rows omit their ~45 MB launcher, and tsv-npm's row is its launcher
  - Local binaries via `./node_modules/.bin/`; tsv is the native binary inside `@fuzdev/tsv`'s platform package (or `TSV_BIN`), tsv-npm runs `@fuzdev/tsv/bin.js` and tsv-wasm `@fuzdev/tsv-wasm/cli.js`, each through a bin shim the harness derives from pnpm's own (the two packages claim the same `tsv` bin name and pnpm links only the WASM one), so they pay the same ~3 ms shell shim every other `.bin/` row pays — [CLAUDE.md](CLAUDE.md) has the detail
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
- **rsvelte-fmt**: 0.7.23
- **tsv**: 0.4.0 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.4.0

_Measured on: AMD Ryzen 5 PRO 7530U with Radeon Graphics · 12 threads · linux x64 — the ratios below depend on the core count._

## Results

<!-- BENCHMARK_RESULTS_START -->

```
=========================================
Benchmarking Large Single File
=========================================

Target: TypeScript compiler parser.ts (~540KB)
Corpus: 539588 bytes, sha256:dcddb577aa14
- 3 warmup runs, 20 benchmark runs
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
  Time (mean ± σ):      1.606 s ±  0.023 s    [User: 1.541 s, System: 0.868 s]
  Range (min … max):    1.548 s …  1.639 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     978.0 ms ±   8.5 ms    [User: 878.8 ms, System: 457.7 ms]
  Range (min … max):   965.4 ms … 998.4 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     109.2 ms ±   1.4 ms    [User: 81.8 ms, System: 34.1 ms]
  Range (min … max):   107.3 ms … 113.8 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      61.8 ms ±   1.9 ms    [User: 48.2 ms, System: 47.5 ms]
  Range (min … max):    59.5 ms …  65.0 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      48.8 ms ±   0.8 ms    [User: 32.4 ms, System: 18.7 ms]
  Range (min … max):    47.7 ms …  50.9 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      18.2 ms ±   0.4 ms    [User: 9.7 ms, System: 8.4 ms]
  Range (min … max):    17.7 ms …  19.2 ms    20 runs

Summary
  tsv ran
    2.68 ± 0.07 times faster than tsv-npm
    3.40 ± 0.13 times faster than oxfmt
    6.00 ± 0.14 times faster than biome
   53.77 ± 1.16 times faster than prettier+oxc-parser
   88.29 ± 2.16 times faster than prettier

Memory Usage:
  prettier: 306.2 MB (min: 291.5 MB, max: 327.2 MB, 21.21 ± 1.42 times more than tsv)
  prettier+oxc-parser: 196.2 MB (min: 193.4 MB, max: 197.8 MB, 13.60 ± 0.83 times more than tsv)
  biome: 94.4 MB (min: 92.9 MB, max: 99.1 MB, 6.54 ± 0.41 times more than tsv)
  oxfmt: 113.8 MB (min: 112.1 MB, max: 114.2 MB, 7.88 ± 0.48 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.3 MB, max: 49.8 MB, 3.43 ± 0.21 times more than tsv)
  tsv: 14.4 MB (min: 13.8 MB, max: 16.1 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.852 s ±  0.134 s    [User: 20.162 s, System: 1.387 s]
  Range (min … max):   11.701 s … 12.017 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.476 s ±  0.174 s    [User: 12.308 s, System: 0.680 s]
  Range (min … max):    9.298 s …  9.747 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     415.9 ms ±   2.2 ms    [User: 3175.5 ms, System: 299.9 ms]
  Range (min … max):   413.0 ms … 419.6 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     142.1 ms ±   1.9 ms    [User: 724.9 ms, System: 346.9 ms]
  Range (min … max):   138.8 ms … 145.4 ms    10 runs

Summary
  oxfmt ran
    2.93 ± 0.04 times faster than biome
   66.69 ± 1.52 times faster than prettier+oxc-parser
   83.42 ± 1.47 times faster than prettier

Memory Usage:
  prettier: 479.6 MB (min: 410.4 MB, max: 531.2 MB, 2.06 ± 0.17 times more than oxfmt)
  prettier+oxc-parser: 320.3 MB (min: 305.1 MB, max: 340.7 MB, 1.37 ± 0.06 times more than oxfmt)
  biome: 182.2 MB (min: 178.5 MB, max: 185.1 MB, 0.78 ± 0.02 times more than oxfmt)
  oxfmt: 233.0 MB (min: 225.8 MB, max: 240.6 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.824 s ±  0.434 s    [User: 57.631 s, System: 6.814 s]
  Range (min … max):   51.341 s … 52.183 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.949 s ±  0.247 s    [User: 81.454 s, System: 5.622 s]
  Range (min … max):    7.711 s …  8.204 s    3 runs

Summary
  oxfmt ran
    6.52 ± 0.21 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1638.6 MB (min: 1500.5 MB, max: 1753.4 MB, 3.67 ± 0.43 times more than oxfmt)
  oxfmt: 447.0 MB (min: 405.4 MB, max: 483.0 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.864 s ±  0.185 s    [User: 34.246 s, System: 2.244 s]
  Range (min … max):   25.653 s … 25.998 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.144 s ±  0.093 s    [User: 30.058 s, System: 3.143 s]
  Range (min … max):    3.046 s …  3.232 s    3 runs

Summary
  oxfmt ran
    8.23 ± 0.25 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 655.4 MB (min: 652.5 MB, max: 659.0 MB, 2.29 ± 0.19 times more than oxfmt)
  oxfmt: 285.9 MB (min: 259.0 MB, max: 301.4 MB)

Full features benchmark complete!


=========================================
Benchmarking TypeScript-only (non-JSX subset)
=========================================

Scope configs agree: .cjs .cts .js .mjs .mts .ts
Target: Outline repository (non-JSX JS/TS subset)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
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
  Time (mean ± σ):      8.319 s ±  0.088 s    [User: 13.843 s, System: 0.882 s]
  Range (min … max):    8.190 s …  8.493 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.908 s ±  0.096 s    [User: 8.845 s, System: 0.584 s]
  Range (min … max):    6.779 s …  7.023 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     304.8 ms ±   2.3 ms    [User: 2196.5 ms, System: 240.6 ms]
  Range (min … max):   301.1 ms … 307.8 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     117.7 ms ±   1.8 ms    [User: 527.1 ms, System: 280.2 ms]
  Range (min … max):   114.9 ms … 120.0 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      81.4 ms ±   1.0 ms    [User: 321.7 ms, System: 136.0 ms]
  Range (min … max):    80.1 ms …  82.5 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      50.1 ms ±   0.4 ms    [User: 291.8 ms, System: 135.4 ms]
  Range (min … max):    49.5 ms …  50.9 ms    10 runs

Summary
  tsv ran
    1.63 ± 0.02 times faster than tsv-npm
    2.35 ± 0.04 times faster than oxfmt
    6.09 ± 0.07 times faster than biome
  137.98 ± 2.24 times faster than prettier+oxc-parser
  166.16 ± 2.25 times faster than prettier

Memory Usage:
  prettier: 455.0 MB (min: 398.5 MB, max: 485.4 MB, 20.87 ± 1.41 times more than tsv)
  prettier+oxc-parser: 306.0 MB (min: 301.3 MB, max: 316.1 MB, 14.04 ± 0.47 times more than tsv)
  biome: 146.2 MB (min: 142.7 MB, max: 148.9 MB, 6.71 ± 0.23 times more than tsv)
  oxfmt: 229.4 MB (min: 224.2 MB, max: 233.4 MB, 10.53 ± 0.35 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.5 MB, max: 49.8 MB, 2.28 ± 0.07 times more than tsv)
  tsv: 21.8 MB (min: 21.0 MB, max: 23.4 MB)

TypeScript-only (non-JSX subset) benchmark complete!


=========================================
Benchmarking Svelte (tsv vs rsvelte-fmt)
=========================================

Target: third-party .svelte corpus (kit, svelte.dev, layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake)
Corpus: fuzdev/corpora@1117b4829309 (collections tree 5f40c547c3ed), snapshot 6214069 2026-09-04
- 3 warmup runs, 10 benchmark runs
- Git reset before each run
- .svelte only: the two Svelte-native formatters head-to-head


Preflight (per-formatter parse check):
  rsvelte-fmt: clean (2226 files, 2023 would change)
  tsv-npm: clean (2226 files, 2041 would change)
  tsv: clean (2226 files, 2041 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: rsvelte-fmt
  Time (mean ± σ):     192.0 ms ±   2.8 ms    [User: 878.0 ms, System: 725.7 ms]
  Range (min … max):   188.7 ms … 196.5 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      77.6 ms ±   1.9 ms    [User: 265.9 ms, System: 166.5 ms]
  Range (min … max):    73.8 ms …  80.3 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      45.9 ms ±   0.4 ms    [User: 250.3 ms, System: 146.9 ms]
  Range (min … max):    45.5 ms …  46.9 ms    10 runs

Summary
  tsv ran
    1.69 ± 0.04 times faster than tsv-npm
    4.18 ± 0.07 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 136.3 MB (min: 123.5 MB, max: 153.9 MB, 9.30 ± 0.65 times more than tsv)
  tsv-npm: 49.4 MB (min: 47.1 MB, max: 49.9 MB, 3.37 ± 0.12 times more than tsv)
  tsv: 14.7 MB (min: 13.9 MB, max: 15.5 MB)

Svelte benchmark complete!


=========================================
Benchmarking tsv Delivery Paths
=========================================

Target: TypeScript compiler parser.ts (~540KB), through each tsv distribution
Corpus: 539588 bytes, sha256:dcddb577aa14
- 3 warmup runs, 20 benchmark runs
- Copy original before each run


Preflight (per-formatter parse check):
  tsv-wasm: clean (1 file, 1 would change)
  tsv-npm: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: tsv-wasm
  Time (mean ± σ):     164.6 ms ±   2.3 ms    [User: 352.9 ms, System: 64.7 ms]
  Range (min … max):   160.1 ms … 169.1 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      49.5 ms ±   1.1 ms    [User: 34.0 ms, System: 17.9 ms]
  Range (min … max):    47.6 ms …  51.8 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      18.5 ms ±   0.5 ms    [User: 12.6 ms, System: 5.9 ms]
  Range (min … max):    17.2 ms …  19.7 ms    20 runs

Summary
  tsv ran
    2.68 ± 0.10 times faster than tsv-npm
    8.90 ± 0.29 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 120.8 MB (min: 116.0 MB, max: 125.6 MB, 8.31 ± 0.55 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.9 MB, 3.41 ± 0.21 times more than tsv)
  tsv: 14.5 MB (min: 13.9 MB, max: 16.1 MB)

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
