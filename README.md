# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds three formatters, three scenarios, and a set of guards against silently unfair comparisons. Upstream's own scenarios are left as they were except where tsv competes in them, plus one lopsided width setting; the deviations are listed in [CLAUDE.md](CLAUDE.md).
>
> - **[tsv](https://tsv.fuz.dev)** is a native-Rust formatter for the JS/TS family, CSS, and Svelte. It's installed from npm like every other formatter here (`@fuzdev/tsv`'s platform package carries the binary); `TSV_BIN` benches a local build instead.
> - **It has no JSX/TSX parser**, so it runs only where the corpus is JSX-free: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only`, which benches Outline's non-JSX subset (`.ts`/`.js`/`.mjs`) with every formatter scoped to that same set.
> - **tsv has two rows wherever it faces another formatter.** `tsv` is the bare native binary; `tsv-npm` is that same binary through `@fuzdev/tsv`'s Node dispatcher, how `npx tsv` runs it. Prettier, Biome, Oxfmt and rsvelte-fmt are all timed through their npm bins, which start Node first (Biome's and rsvelte-fmt's then launch a native binary, as tsv's dispatcher does), so `tsv-npm` is the like-for-like row against them and `tsv` is what the binary costs on its own. Ratios are still taken against `tsv`.
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
- **rsvelte-fmt**: 0.7.11
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
  Time (mean ± σ):      1.605 s ±  0.025 s    [User: 1.526 s, System: 0.881 s]
  Range (min … max):    1.537 s …  1.669 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     971.9 ms ±   7.9 ms    [User: 876.6 ms, System: 449.9 ms]
  Range (min … max):   955.1 ms … 986.9 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     108.1 ms ±   0.9 ms    [User: 82.7 ms, System: 32.2 ms]
  Range (min … max):   106.1 ms … 109.9 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      61.7 ms ±   1.9 ms    [User: 42.8 ms, System: 51.6 ms]
  Range (min … max):    59.1 ms …  65.3 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      48.4 ms ±   1.1 ms    [User: 30.0 ms, System: 20.6 ms]
  Range (min … max):    46.7 ms …  51.7 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      18.2 ms ±   0.4 ms    [User: 11.1 ms, System: 7.1 ms]
  Range (min … max):    17.5 ms …  18.8 ms    20 runs

Summary
  tsv ran
    2.66 ± 0.08 times faster than tsv-npm
    3.39 ± 0.13 times faster than oxfmt
    5.94 ± 0.13 times faster than biome
   53.42 ± 1.19 times faster than prettier+oxc-parser
   88.21 ± 2.28 times faster than prettier

Memory Usage:
  prettier: 303.8 MB (min: 292.5 MB, max: 318.4 MB, 21.32 ± 1.48 times more than tsv)
  prettier+oxc-parser: 197.2 MB (min: 195.4 MB, max: 198.3 MB, 13.84 ± 0.89 times more than tsv)
  biome: 95.4 MB (min: 92.7 MB, max: 99.8 MB, 6.70 ± 0.45 times more than tsv)
  oxfmt: 114.1 MB (min: 113.8 MB, max: 114.3 MB, 8.01 ± 0.51 times more than tsv)
  tsv-npm: 49.4 MB (min: 47.4 MB, max: 49.8 MB, 3.47 ± 0.22 times more than tsv)
  tsv: 14.2 MB (min: 13.7 MB, max: 18.1 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.868 s ±  0.208 s    [User: 19.971 s, System: 1.353 s]
  Range (min … max):   11.544 s … 12.146 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.609 s ±  0.244 s    [User: 12.534 s, System: 0.715 s]
  Range (min … max):    9.297 s …  9.947 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     413.9 ms ±   2.1 ms    [User: 3172.6 ms, System: 282.5 ms]
  Range (min … max):   411.0 ms … 416.7 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     141.0 ms ±   2.8 ms    [User: 741.4 ms, System: 328.8 ms]
  Range (min … max):   137.4 ms … 146.5 ms    10 runs

Summary
  oxfmt ran
    2.94 ± 0.06 times faster than biome
   68.15 ± 2.19 times faster than prettier+oxc-parser
   84.17 ± 2.23 times faster than prettier

Memory Usage:
  prettier: 480.5 MB (min: 407.9 MB, max: 705.9 MB, 2.07 ± 0.39 times more than oxfmt)
  prettier+oxc-parser: 323.7 MB (min: 305.9 MB, max: 364.8 MB, 1.39 ± 0.10 times more than oxfmt)
  biome: 181.3 MB (min: 177.1 MB, max: 186.8 MB, 0.78 ± 0.03 times more than oxfmt)
  oxfmt: 232.3 MB (min: 219.6 MB, max: 246.6 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     52.313 s ±  0.318 s    [User: 58.025 s, System: 6.928 s]
  Range (min … max):   52.008 s … 52.644 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.730 s ±  0.109 s    [User: 82.474 s, System: 5.849 s]
  Range (min … max):    7.606 s …  7.810 s    3 runs

Summary
  oxfmt ran
    6.77 ± 0.10 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1738.9 MB (min: 1680.1 MB, max: 1786.9 MB, 4.10 ± 0.22 times more than oxfmt)
  oxfmt: 424.2 MB (min: 403.2 MB, max: 437.2 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.850 s ±  0.177 s    [User: 34.269 s, System: 2.092 s]
  Range (min … max):   25.694 s … 26.042 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.059 s ±  0.083 s    [User: 29.576 s, System: 3.089 s]
  Range (min … max):    2.990 s …  3.151 s    3 runs

Summary
  oxfmt ran
    8.45 ± 0.24 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 687.7 MB (min: 647.7 MB, max: 752.1 MB, 2.29 ± 0.24 times more than oxfmt)
  oxfmt: 300.4 MB (min: 279.2 MB, max: 316.1 MB)

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
  tsv-npm: clean (1648 files, 1644 would change)
  tsv: clean (1648 files, 1644 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      8.340 s ±  0.112 s    [User: 13.817 s, System: 0.983 s]
  Range (min … max):    8.232 s …  8.517 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.910 s ±  0.054 s    [User: 8.876 s, System: 0.561 s]
  Range (min … max):    6.850 s …  6.985 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     303.4 ms ±   2.3 ms    [User: 2184.6 ms, System: 230.2 ms]
  Range (min … max):   301.0 ms … 305.8 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     118.4 ms ±   2.3 ms    [User: 528.5 ms, System: 291.5 ms]
  Range (min … max):   114.6 ms … 120.5 ms    5 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      81.1 ms ±   0.9 ms    [User: 320.0 ms, System: 144.0 ms]
  Range (min … max):    80.0 ms …  82.1 ms    5 runs

Benchmark 6: tsv
  Time (mean ± σ):      50.1 ms ±   0.3 ms    [User: 293.8 ms, System: 134.3 ms]
  Range (min … max):    49.6 ms …  50.4 ms    5 runs

Summary
  tsv ran
    1.62 ± 0.02 times faster than tsv-npm
    2.37 ± 0.05 times faster than oxfmt
    6.06 ± 0.06 times faster than biome
  138.03 ± 1.42 times faster than prettier+oxc-parser
  166.59 ± 2.51 times faster than prettier

Memory Usage:
  prettier: 443.9 MB (min: 385.9 MB, max: 484.5 MB, 20.02 ± 2.10 times more than tsv)
  prettier+oxc-parser: 306.7 MB (min: 302.1 MB, max: 310.0 MB, 13.83 ± 0.69 times more than tsv)
  biome: 144.3 MB (min: 141.1 MB, max: 148.1 MB, 6.51 ± 0.35 times more than tsv)
  oxfmt: 229.9 MB (min: 220.1 MB, max: 236.6 MB, 10.37 ± 0.59 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.5 MB, max: 49.7 MB, 2.24 ± 0.11 times more than tsv)
  tsv: 22.2 MB (min: 20.4 MB, max: 23.1 MB)

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
  rsvelte-fmt: clean (2226 files, 2023 would change)
  tsv-npm: clean (2226 files, 2041 would change)
  tsv: clean (2226 files, 2041 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: rsvelte-fmt
  Time (mean ± σ):     182.2 ms ±   3.9 ms    [User: 749.3 ms, System: 714.3 ms]
  Range (min … max):   177.0 ms … 187.1 ms    5 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      75.0 ms ±   1.6 ms    [User: 266.8 ms, System: 147.0 ms]
  Range (min … max):    73.0 ms …  77.0 ms    5 runs

Benchmark 3: tsv
  Time (mean ± σ):      46.2 ms ±   0.5 ms    [User: 238.4 ms, System: 159.1 ms]
  Range (min … max):    45.5 ms …  47.0 ms    5 runs

Summary
  tsv ran
    1.62 ± 0.04 times faster than tsv-npm
    3.94 ± 0.10 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 132.8 MB (min: 122.9 MB, max: 144.9 MB, 9.40 ± 0.61 times more than tsv)
  tsv-npm: 49.7 MB (min: 49.3 MB, max: 49.9 MB, 3.52 ± 0.07 times more than tsv)
  tsv: 14.1 MB (min: 13.8 MB, max: 14.5 MB)

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
  Time (mean ± σ):     166.1 ms ±   4.2 ms    [User: 364.7 ms, System: 59.6 ms]
  Range (min … max):   162.6 ms … 180.5 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      49.1 ms ±   0.8 ms    [User: 33.7 ms, System: 17.7 ms]
  Range (min … max):    48.1 ms …  51.3 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      18.4 ms ±   0.4 ms    [User: 13.2 ms, System: 5.1 ms]
  Range (min … max):    18.0 ms …  19.4 ms    20 runs

Summary
  tsv ran
    2.66 ± 0.07 times faster than tsv-npm
    9.01 ± 0.30 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 120.9 MB (min: 116.0 MB, max: 124.1 MB, 8.54 ± 0.32 times more than tsv)
  tsv-npm: 49.3 MB (min: 47.5 MB, max: 49.8 MB, 3.48 ± 0.13 times more than tsv)
  tsv: 14.2 MB (min: 13.9 MB, max: 16.1 MB)

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
