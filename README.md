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
  Time (mean ± σ):      1.581 s ±  0.031 s    [User: 1.550 s, System: 0.841 s]
  Range (min … max):    1.544 s …  1.627 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     980.2 ms ±   9.7 ms    [User: 868.9 ms, System: 467.4 ms]
  Range (min … max):   970.2 ms … 994.7 ms    5 runs

Benchmark 3: biome
  Time (mean ± σ):     108.2 ms ±   0.8 ms    [User: 84.4 ms, System: 31.0 ms]
  Range (min … max):   107.1 ms … 109.0 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      62.5 ms ±   2.1 ms    [User: 47.0 ms, System: 48.2 ms]
  Range (min … max):    60.4 ms …  64.9 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      18.2 ms ±   0.1 ms    [User: 9.1 ms, System: 9.2 ms]
  Range (min … max):    18.0 ms …  18.3 ms    5 runs

Summary
  tsv ran
    3.44 ± 0.12 times faster than oxfmt
    5.95 ± 0.06 times faster than biome
   53.93 ± 0.63 times faster than prettier+oxc-parser
   86.97 ± 1.78 times faster than prettier

Memory Usage:
  prettier: 312.0 MB (min: 299.3 MB, max: 322.9 MB, 21.54 ± 1.54 times more than tsv)
  prettier+oxc-parser: 197.3 MB (min: 197.0 MB, max: 197.7 MB, 13.62 ± 0.91 times more than tsv)
  biome: 94.9 MB (min: 93.8 MB, max: 97.7 MB, 6.55 ± 0.45 times more than tsv)
  oxfmt: 113.7 MB (min: 112.3 MB, max: 114.3 MB, 7.85 ± 0.52 times more than tsv)
  tsv: 14.5 MB (min: 13.9 MB, max: 16.2 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     12.007 s ±  0.139 s    [User: 20.117 s, System: 1.461 s]
  Range (min … max):   11.732 s … 12.175 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.536 s ±  0.092 s    [User: 12.217 s, System: 0.734 s]
  Range (min … max):    9.347 s …  9.648 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     414.6 ms ±   2.7 ms    [User: 3155.6 ms, System: 292.8 ms]
  Range (min … max):   410.9 ms … 419.2 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     143.0 ms ±   3.7 ms    [User: 732.6 ms, System: 332.8 ms]
  Range (min … max):   137.8 ms … 149.0 ms    10 runs

Summary
  oxfmt ran
    2.90 ± 0.08 times faster than biome
   66.70 ± 1.86 times faster than prettier+oxc-parser
   83.99 ± 2.40 times faster than prettier

Memory Usage:
  prettier: 455.5 MB (min: 401.4 MB, max: 522.5 MB, 1.96 ± 0.22 times more than oxfmt)
  prettier+oxc-parser: 326.6 MB (min: 313.5 MB, max: 394.5 MB, 1.40 ± 0.12 times more than oxfmt)
  biome: 182.3 MB (min: 178.8 MB, max: 186.3 MB, 0.78 ± 0.03 times more than oxfmt)
  oxfmt: 232.6 MB (min: 227.5 MB, max: 251.2 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     52.069 s ±  0.447 s    [User: 58.603 s, System: 6.909 s]
  Range (min … max):   51.557 s … 52.380 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.910 s ±  0.119 s    [User: 84.899 s, System: 6.050 s]
  Range (min … max):    7.796 s …  8.033 s    3 runs

Summary
  oxfmt ran
    6.58 ± 0.11 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1699.2 MB (min: 1643.5 MB, max: 1809.5 MB, 3.92 ± 0.54 times more than oxfmt)
  oxfmt: 433.2 MB (min: 394.7 MB, max: 494.8 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.865 s ±  0.249 s    [User: 34.076 s, System: 2.280 s]
  Range (min … max):   25.618 s … 26.117 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.107 s ±  0.058 s    [User: 30.219 s, System: 3.169 s]
  Range (min … max):    3.045 s …  3.161 s    3 runs

Summary
  oxfmt ran
    8.32 ± 0.18 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 703.0 MB (min: 659.9 MB, max: 750.9 MB, 2.38 ± 0.19 times more than oxfmt)
  oxfmt: 295.2 MB (min: 278.8 MB, max: 305.8 MB)

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
  Time (mean ± σ):      8.423 s ±  0.087 s    [User: 13.953 s, System: 0.924 s]
  Range (min … max):    8.276 s …  8.493 s    5 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.937 s ±  0.043 s    [User: 8.875 s, System: 0.571 s]
  Range (min … max):    6.891 s …  6.981 s    5 runs

Benchmark 3: biome
  Time (mean ± σ):     304.8 ms ±   2.2 ms    [User: 2198.1 ms, System: 218.3 ms]
  Range (min … max):   302.6 ms … 308.3 ms    5 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     116.5 ms ±   2.5 ms    [User: 549.2 ms, System: 245.3 ms]
  Range (min … max):   114.1 ms … 120.3 ms    5 runs

Benchmark 5: tsv
  Time (mean ± σ):      48.5 ms ±   0.4 ms    [User: 311.1 ms, System: 105.4 ms]
  Range (min … max):    48.1 ms …  49.0 ms    5 runs

Summary
  tsv ran
    2.40 ± 0.06 times faster than oxfmt
    6.28 ± 0.07 times faster than biome
  143.01 ± 1.48 times faster than prettier+oxc-parser
  173.63 ± 2.29 times faster than prettier

Memory Usage:
  prettier: 436.1 MB (min: 402.7 MB, max: 468.8 MB, 20.02 ± 1.47 times more than tsv)
  prettier+oxc-parser: 303.4 MB (min: 300.8 MB, max: 305.8 MB, 13.93 ± 0.24 times more than tsv)
  biome: 146.4 MB (min: 143.4 MB, max: 149.3 MB, 6.72 ± 0.16 times more than tsv)
  oxfmt: 231.0 MB (min: 219.7 MB, max: 243.9 MB, 10.61 ± 0.43 times more than tsv)
  tsv: 21.8 MB (min: 21.2 MB, max: 22.1 MB)

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
  Time (mean ± σ):      43.6 ms ±   0.2 ms    [User: 240.1 ms, System: 137.0 ms]
  Range (min … max):    43.3 ms …  43.8 ms    5 runs

Benchmark 2: rsvelte-fmt
  Time (mean ± σ):     184.8 ms ±   6.6 ms    [User: 735.9 ms, System: 714.3 ms]
  Range (min … max):   176.3 ms … 194.4 ms    5 runs

Summary
  tsv ran
    4.24 ± 0.15 times faster than rsvelte-fmt

Memory Usage:
  tsv: 14.7 MB (min: 14.6 MB, max: 14.9 MB)
  rsvelte-fmt: 140.9 MB (min: 124.7 MB, max: 152.9 MB, 9.56 ± 0.84 times more than tsv)

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
  Time (mean ± σ):     163.6 ms ±   4.8 ms    [User: 362.3 ms, System: 55.5 ms]
  Range (min … max):   158.2 ms … 169.6 ms    5 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      45.3 ms ±   0.8 ms    [User: 31.1 ms, System: 16.1 ms]
  Range (min … max):    44.6 ms …  46.5 ms    5 runs

Benchmark 3: tsv
  Time (mean ± σ):      18.5 ms ±   0.4 ms    [User: 11.0 ms, System: 7.4 ms]
  Range (min … max):    17.8 ms …  19.0 ms    5 runs

Summary
  tsv ran
    2.45 ± 0.07 times faster than tsv-npm
    8.84 ± 0.33 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 121.4 MB (min: 117.8 MB, max: 124.3 MB, 8.29 ± 0.59 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.5 MB, max: 49.7 MB, 3.39 ± 0.23 times more than tsv)
  tsv: 14.7 MB (min: 13.8 MB, max: 15.8 MB)

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
