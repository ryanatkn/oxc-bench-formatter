# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds [tsv](https://tsv.fuz.dev) — a native-Rust formatter for the JS/TS family, CSS, and Svelte — plus three scenarios and a set of guards against silently unfair comparisons. Changes to upstream's own scenarios are small, except `bench-large-single-file`, which gains the tsv rows and those guards; [CLAUDE.md](CLAUDE.md) lists every deviation and the full methodology.
>
> - **tsv has no JSX/TSX parser**, so it runs only on JSX-free corpora: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only` (Outline's `.ts`/`.js`/`.mjs` files, every formatter scoped to that same set) and `bench-svelte`, plus the tsv-only `bench-tsv-delivery`.
> - **`bench-svelte`** puts tsv against [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on 2,226 third-party `.svelte` files; rsvelte-fmt's time includes the oxfmt it launches for non-`.svelte` files, which walks the corpus and finds none. rsvelte-fmt 0.7.x aborts (SIGABRT) when its check output and stderr share one pipe — its Node-run oxfmt leg leaves that pipe non-blocking and a full write panics — so preflight merges each check's output into a file rather than a pipe; the timed runs were never exposed. Should a run still abort, it publishes as-is, abort line included.
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
  Time (mean ± σ):      1.611 s ±  0.024 s    [User: 1.535 s, System: 0.882 s]
  Range (min … max):    1.558 s …  1.660 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     973.6 ms ±  11.1 ms    [User: 888.1 ms, System: 444.5 ms]
  Range (min … max):   955.3 ms … 995.4 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     107.9 ms ±   1.5 ms    [User: 79.0 ms, System: 35.8 ms]
  Range (min … max):   105.5 ms … 110.7 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      62.2 ms ±   1.9 ms    [User: 43.9 ms, System: 50.4 ms]
  Range (min … max):    59.7 ms …  65.9 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.6 ms ±   0.7 ms    [User: 28.7 ms, System: 20.0 ms]
  Range (min … max):    44.9 ms …  47.6 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.5 ms ±   0.4 ms    [User: 11.0 ms, System: 5.5 ms]
  Range (min … max):    15.8 ms …  17.2 ms    20 runs

Summary
  tsv ran
    2.82 ± 0.08 times faster than tsv-npm
    3.76 ± 0.15 times faster than oxfmt
    6.53 ± 0.19 times faster than biome
   58.91 ± 1.64 times faster than prettier+oxc-parser
   97.48 ± 2.88 times faster than prettier

Memory Usage:
  prettier: 305.0 MB (min: 292.6 MB, max: 316.9 MB, 22.83 ± 0.54 times more than tsv)
  prettier+oxc-parser: 196.4 MB (min: 192.9 MB, max: 198.4 MB, 14.70 ± 0.21 times more than tsv)
  biome: 95.7 MB (min: 93.8 MB, max: 99.5 MB, 7.16 ± 0.17 times more than tsv)
  oxfmt: 114.1 MB (min: 113.8 MB, max: 114.3 MB, 8.54 ± 0.10 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.3 MB, max: 49.6 MB, 3.70 ± 0.04 times more than tsv)
  tsv: 13.4 MB (min: 13.1 MB, max: 13.7 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.873 s ±  0.171 s    [User: 19.997 s, System: 1.411 s]
  Range (min … max):   11.673 s … 12.183 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.481 s ±  0.174 s    [User: 12.294 s, System: 0.724 s]
  Range (min … max):    9.282 s …  9.770 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     414.6 ms ±   4.2 ms    [User: 3142.8 ms, System: 298.2 ms]
  Range (min … max):   409.5 ms … 423.9 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     142.0 ms ±   3.4 ms    [User: 741.0 ms, System: 319.1 ms]
  Range (min … max):   137.8 ms … 147.2 ms    10 runs

Summary
  oxfmt ran
    2.92 ± 0.08 times faster than biome
   66.75 ± 2.00 times faster than prettier+oxc-parser
   83.59 ± 2.32 times faster than prettier

Memory Usage:
  prettier: 443.5 MB (min: 399.7 MB, max: 594.9 MB, 1.92 ± 0.25 times more than oxfmt)
  prettier+oxc-parser: 318.5 MB (min: 309.6 MB, max: 334.7 MB, 1.38 ± 0.05 times more than oxfmt)
  biome: 182.8 MB (min: 179.8 MB, max: 185.6 MB, 0.79 ± 0.02 times more than oxfmt)
  oxfmt: 230.5 MB (min: 220.6 MB, max: 238.6 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.952 s ±  0.131 s    [User: 57.601 s, System: 6.908 s]
  Range (min … max):   51.855 s … 52.101 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.832 s ±  0.465 s    [User: 79.842 s, System: 5.934 s]
  Range (min … max):    7.497 s …  8.363 s    3 runs

Summary
  oxfmt ran
    6.63 ± 0.39 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1717.4 MB (min: 1645.4 MB, max: 1753.4 MB, 3.92 ± 0.31 times more than oxfmt)
  oxfmt: 437.8 MB (min: 405.3 MB, max: 465.8 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.818 s ±  0.098 s    [User: 34.144 s, System: 2.197 s]
  Range (min … max):   25.735 s … 25.926 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.213 s ±  0.063 s    [User: 29.060 s, System: 2.991 s]
  Range (min … max):    3.148 s …  3.275 s    3 runs

Summary
  oxfmt ran
    8.04 ± 0.16 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 649.4 MB (min: 622.9 MB, max: 664.4 MB, 2.15 ± 0.08 times more than oxfmt)
  oxfmt: 301.9 MB (min: 297.4 MB, max: 306.9 MB)

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
  Time (mean ± σ):      8.322 s ±  0.110 s    [User: 13.853 s, System: 0.927 s]
  Range (min … max):    8.175 s …  8.503 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.855 s ±  0.065 s    [User: 8.796 s, System: 0.551 s]
  Range (min … max):    6.742 s …  6.950 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     300.2 ms ±   1.9 ms    [User: 2159.4 ms, System: 232.5 ms]
  Range (min … max):   297.5 ms … 302.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     116.1 ms ±   1.2 ms    [User: 531.2 ms, System: 253.3 ms]
  Range (min … max):   114.4 ms … 118.5 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      76.2 ms ±   1.4 ms    [User: 299.2 ms, System: 120.4 ms]
  Range (min … max):    74.2 ms …  79.4 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      45.4 ms ±   0.9 ms    [User: 262.1 ms, System: 122.5 ms]
  Range (min … max):    44.7 ms …  47.6 ms    10 runs

Summary
  tsv ran
    1.68 ± 0.04 times faster than tsv-npm
    2.56 ± 0.05 times faster than oxfmt
    6.62 ± 0.13 times faster than biome
  151.15 ± 3.19 times faster than prettier+oxc-parser
  183.47 ± 4.22 times faster than prettier

Memory Usage:
  prettier: 451.2 MB (min: 398.1 MB, max: 479.3 MB, 21.77 ± 1.15 times more than tsv)
  prettier+oxc-parser: 304.8 MB (min: 298.6 MB, max: 321.8 MB, 14.71 ± 0.48 times more than tsv)
  biome: 146.0 MB (min: 141.9 MB, max: 147.8 MB, 7.05 ± 0.19 times more than tsv)
  oxfmt: 227.2 MB (min: 218.7 MB, max: 230.9 MB, 10.96 ± 0.31 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.3 MB, max: 49.8 MB, 2.39 ± 0.06 times more than tsv)
  tsv: 20.7 MB (min: 19.8 MB, max: 21.5 MB)

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
  Time (mean ± σ):     195.5 ms ±   7.9 ms    [User: 844.0 ms, System: 696.1 ms]
  Range (min … max):   185.3 ms … 206.1 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      71.4 ms ±   1.0 ms    [User: 248.1 ms, System: 138.9 ms]
  Range (min … max):    70.2 ms …  73.2 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      41.0 ms ±   0.2 ms    [User: 220.8 ms, System: 134.1 ms]
  Range (min … max):    40.7 ms …  41.4 ms    10 runs

Summary
  tsv ran
    1.74 ± 0.03 times faster than tsv-npm
    4.77 ± 0.20 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 139.4 MB (min: 125.4 MB, max: 151.5 MB, 10.84 ± 0.69 times more than tsv)
  tsv-npm: 49.4 MB (min: 47.5 MB, max: 49.8 MB, 3.84 ± 0.10 times more than tsv)
  tsv: 12.9 MB (min: 12.4 MB, max: 13.3 MB)

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
  Time (mean ± σ):     152.5 ms ±   4.2 ms    [User: 324.5 ms, System: 54.9 ms]
  Range (min … max):   147.6 ms … 166.9 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      47.3 ms ±   0.9 ms    [User: 27.5 ms, System: 22.2 ms]
  Range (min … max):    45.8 ms …  49.6 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      16.6 ms ±   0.5 ms    [User: 11.0 ms, System: 5.6 ms]
  Range (min … max):    15.9 ms …  18.0 ms    20 runs

Summary
  tsv ran
    2.85 ± 0.11 times faster than tsv-npm
    9.18 ± 0.39 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 117.0 MB (min: 111.5 MB, max: 121.7 MB, 8.74 ± 0.21 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.9 MB, 3.71 ± 0.04 times more than tsv)
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
