# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds [tsv](https://tsv.fuz.dev) — a native-Rust formatter for the JS/TS family, CSS, and Svelte — plus three scenarios and a set of guards against silently unfair comparisons. Changes to upstream's own scenarios are small, except `bench-large-single-file`, which gains the tsv rows and those guards; [CLAUDE.md](CLAUDE.md) lists every deviation and the full methodology.
>
> - **tsv has no JSX/TSX parser**, so it runs only on JSX-free corpora: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only` (Outline's non-JSX JS/TS files, every formatter scoped to that same set) and `bench-svelte`, plus the tsv-only `bench-tsv-delivery`.
> - **`bench-svelte`** puts tsv against [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on 1,113 third-party `.svelte` files; rsvelte-fmt's time includes the oxfmt it launches for non-`.svelte` files, which walks the corpus and finds none. rsvelte-fmt 0.7.x aborts (SIGABRT) when its check output and stderr share one pipe — its Node-run oxfmt leg leaves that pipe non-blocking and a full write panics — so preflight merges each check's output into a file rather than a pipe; the timed runs were never exposed. Should a run still abort, it publishes as-is, abort line included.
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
| `tsv-wasm` | the same CLI contract, mirrored in JS over a WASM engine in Node (`@fuzdev/tsv-wasm`) — the package for platforms with no prebuilt binary                       | `bench-tsv-delivery` only |

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
and preflight rows), when and from which harness commit it ran, the versions and
machine, and `node_startup`, a bare `node -e ""` timed the same way (the launch
floor every npm-bin row pays).

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
  - [Outline](https://github.com/outline/outline) again, scoped to its non-JSX subset — the set every formatter including tsv supports (fork-added)
  - 1,113 `.svelte` files from seven third-party sources (SvelteKit, svelte.dev, layerchart, svelte-ux, flowbite-svelte's `src/lib`, svelte-maplibre, layercake), read from [fuzdev/corpora](https://github.com/fuzdev/corpora) at a pinned commit (fork-added)
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
  - Each scenario prints the corpus commit (or the file's content hash) it ran against — in the block below and in `results.json` — and the cloned corpora are pinned to fixed commits (`shared/corpus-pins.mjs`), so a rerun formats the same bytes

## Versions

- **Prettier**: 3.9.6
- **@prettier/plugin-oxc**: 0.2.2
- **Biome**: 2.5.13
- **Oxfmt**: 0.68.0
- **rsvelte-fmt**: 0.7.23
- **tsv**: 0.5.0 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.5.0
- **Node**: 24.14.1

_Measured on: AMD Ryzen 5 PRO 7530U with Radeon Graphics · 12 threads · linux x86_64 — the ratios below depend on the core count._

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
  Time (mean ± σ):      1.618 s ±  0.028 s    [User: 1.530 s, System: 0.895 s]
  Range (min … max):    1.575 s …  1.670 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     976.9 ms ±  12.9 ms    [User: 879.3 ms, System: 454.2 ms]
  Range (min … max):   939.7 ms … 989.4 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     108.2 ms ±   1.4 ms    [User: 80.3 ms, System: 34.6 ms]
  Range (min … max):   105.3 ms … 112.2 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      62.0 ms ±   2.0 ms    [User: 42.3 ms, System: 53.0 ms]
  Range (min … max):    59.2 ms …  66.3 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.5 ms ±   0.9 ms    [User: 29.5 ms, System: 19.3 ms]
  Range (min … max):    44.8 ms …  47.8 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.4 ms ±   0.5 ms    [User: 8.4 ms, System: 7.9 ms]
  Range (min … max):    15.5 ms …  17.3 ms    20 runs

Summary
  tsv ran
    2.84 ± 0.09 times faster than tsv-npm
    3.78 ± 0.16 times faster than oxfmt
    6.60 ± 0.20 times faster than biome
   59.60 ± 1.84 times faster than prettier+oxc-parser
   98.72 ± 3.23 times faster than prettier

Memory Usage:
  prettier: 306.2 MB (min: 292.3 MB, max: 321.4 MB, 22.82 ± 0.66 times more than tsv)
  prettier+oxc-parser: 197.0 MB (min: 195.6 MB, max: 197.9 MB, 14.68 ± 0.13 times more than tsv)
  biome: 95.9 MB (min: 92.9 MB, max: 99.3 MB, 7.15 ± 0.16 times more than tsv)
  oxfmt: 114.1 MB (min: 113.8 MB, max: 114.2 MB, 8.50 ± 0.07 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.4 MB, max: 49.6 MB, 3.69 ± 0.03 times more than tsv)
  tsv: 13.4 MB (min: 13.1 MB, max: 13.6 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.935 s ±  0.188 s    [User: 20.237 s, System: 1.340 s]
  Range (min … max):   11.624 s … 12.184 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.494 s ±  0.095 s    [User: 12.310 s, System: 0.714 s]
  Range (min … max):    9.374 s …  9.627 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     414.2 ms ±   2.4 ms    [User: 3166.2 ms, System: 286.6 ms]
  Range (min … max):   409.7 ms … 418.1 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     141.4 ms ±   2.8 ms    [User: 760.4 ms, System: 296.6 ms]
  Range (min … max):   136.4 ms … 146.1 ms    10 runs

Summary
  oxfmt ran
    2.93 ± 0.06 times faster than biome
   67.16 ± 1.49 times faster than prettier+oxc-parser
   84.43 ± 2.14 times faster than prettier

Memory Usage:
  prettier: 471.4 MB (min: 399.8 MB, max: 602.2 MB, 2.04 ± 0.29 times more than oxfmt)
  prettier+oxc-parser: 330.9 MB (min: 309.0 MB, max: 385.4 MB, 1.43 ± 0.11 times more than oxfmt)
  biome: 182.7 MB (min: 181.1 MB, max: 185.9 MB, 0.79 ± 0.02 times more than oxfmt)
  oxfmt: 231.0 MB (min: 223.2 MB, max: 239.3 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     52.011 s ±  0.250 s    [User: 57.472 s, System: 6.994 s]
  Range (min … max):   51.760 s … 52.260 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      8.160 s ±  0.276 s    [User: 84.463 s, System: 6.097 s]
  Range (min … max):    7.971 s …  8.476 s    3 runs

Summary
  oxfmt ran
    6.37 ± 0.22 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1675.2 MB (min: 1575.3 MB, max: 1757.2 MB, 3.87 ± 0.57 times more than oxfmt)
  oxfmt: 432.8 MB (min: 398.5 MB, max: 500.8 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.811 s ±  0.160 s    [User: 34.193 s, System: 2.140 s]
  Range (min … max):   25.631 s … 25.939 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.260 s ±  0.016 s    [User: 29.869 s, System: 3.082 s]
  Range (min … max):    3.245 s …  3.277 s    3 runs

Summary
  oxfmt ran
    7.92 ± 0.06 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 667.4 MB (min: 658.9 MB, max: 679.6 MB, 2.10 ± 0.17 times more than oxfmt)
  oxfmt: 318.2 MB (min: 297.2 MB, max: 347.2 MB)

Full features benchmark complete!


=========================================
Benchmarking TypeScript-only (non-JSX subset)
=========================================

Scope configs agree: .cjs .cts .js .mjs .mts .ts
Target: Outline repository (non-JSX JS/TS subset)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs, 10s settle before each formatter
- Git reset before each run
- .ts/.mts/.cts/.js/.mjs/.cjs only: the common file set every formatter (incl. tsv) supports


Preflight (per-formatter parse check):
  prettier: clean (1644 would change)
  prettier+oxc-parser: clean (1644 would change)
  biome: clean (1648 files, 1644 would change)
  oxfmt: clean (1648 files, 1644 would change)
  tsv-npm: clean (1648 files, 1644 would change)
  tsv: clean (1648 files, 1644 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      8.345 s ±  0.116 s    [User: 13.900 s, System: 0.916 s]
  Range (min … max):    8.211 s …  8.551 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.896 s ±  0.087 s    [User: 8.823 s, System: 0.561 s]
  Range (min … max):    6.758 s …  7.009 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     302.7 ms ±   5.1 ms    [User: 2174.5 ms, System: 204.7 ms]
  Range (min … max):   299.0 ms … 316.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     115.4 ms ±   2.9 ms    [User: 521.1 ms, System: 276.9 ms]
  Range (min … max):   110.1 ms … 120.5 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      74.8 ms ±   1.0 ms    [User: 281.2 ms, System: 125.6 ms]
  Range (min … max):    73.4 ms …  76.8 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      43.6 ms ±   0.3 ms    [User: 252.8 ms, System: 119.2 ms]
  Range (min … max):    43.3 ms …  44.1 ms    10 runs

Summary
  tsv ran
    1.72 ± 0.03 times faster than tsv-npm
    2.65 ± 0.07 times faster than oxfmt
    6.95 ± 0.13 times faster than biome
  158.28 ± 2.29 times faster than prettier+oxc-parser
  191.51 ± 2.97 times faster than prettier

Memory Usage:
  prettier: 462.5 MB (min: 388.8 MB, max: 568.1 MB, 22.52 ± 2.81 times more than tsv)
  prettier+oxc-parser: 306.4 MB (min: 301.8 MB, max: 321.8 MB, 14.92 ± 0.36 times more than tsv)
  biome: 146.0 MB (min: 142.2 MB, max: 149.1 MB, 7.11 ± 0.15 times more than tsv)
  oxfmt: 227.0 MB (min: 221.6 MB, max: 236.7 MB, 11.05 ± 0.29 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.5 MB, max: 49.9 MB, 2.42 ± 0.04 times more than tsv)
  tsv: 20.5 MB (min: 20.1 MB, max: 21.1 MB)

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
  Time (mean ± σ):     196.6 ms ±   6.5 ms    [User: 846.6 ms, System: 747.5 ms]
  Range (min … max):   185.9 ms … 208.5 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      70.3 ms ±   1.1 ms    [User: 248.0 ms, System: 125.4 ms]
  Range (min … max):    68.6 ms …  71.4 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      39.4 ms ±   0.3 ms    [User: 211.3 ms, System: 128.8 ms]
  Range (min … max):    39.0 ms …  39.9 ms    10 runs

Summary
  tsv ran
    1.78 ± 0.03 times faster than tsv-npm
    4.99 ± 0.17 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 139.3 MB (min: 131.3 MB, max: 145.4 MB, 11.05 ± 0.41 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.7 MB, 3.93 ± 0.07 times more than tsv)
  tsv: 12.6 MB (min: 12.2 MB, max: 12.9 MB)

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
  Time (mean ± σ):     155.7 ms ±   4.9 ms    [User: 322.1 ms, System: 57.2 ms]
  Range (min … max):   149.4 ms … 166.5 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      47.3 ms ±   0.6 ms    [User: 33.0 ms, System: 16.6 ms]
  Range (min … max):    46.3 ms …  48.4 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      16.5 ms ±   0.3 ms    [User: 11.5 ms, System: 5.0 ms]
  Range (min … max):    16.1 ms …  17.0 ms    20 runs

Summary
  tsv ran
    2.86 ± 0.06 times faster than tsv-npm
    9.41 ± 0.34 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 116.7 MB (min: 110.3 MB, max: 122.9 MB, 8.68 ± 0.26 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.2 MB, max: 49.7 MB, 3.69 ± 0.03 times more than tsv)
  tsv: 13.4 MB (min: 13.3 MB, max: 13.7 MB)

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
