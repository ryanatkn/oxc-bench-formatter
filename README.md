# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds [tsv](https://tsv.fuz.dev) — a native-Rust formatter for the JS/TS family, CSS, and Svelte — plus three scenarios and a set of guards against silently unfair comparisons. Changes to upstream's own scenarios are small, except `bench-large-single-file`, which gains the tsv rows and those guards; [CLAUDE.md](CLAUDE.md) lists every deviation and the full methodology.
>
> - **tsv has no JSX/TSX parser**, so it runs only on JSX-free corpora: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only` (Outline's non-JSX JS/TS files, every formatter scoped to that same set) and `bench-svelte`, plus the tsv-only `bench-tsv-delivery`.
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
  - [Outline](https://github.com/outline/outline) again, scoped to its non-JSX subset — the set every formatter including tsv supports (fork-added)
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
  Time (mean ± σ):      1.620 s ±  0.026 s    [User: 1.555 s, System: 0.865 s]
  Range (min … max):    1.557 s …  1.660 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     976.7 ms ±   8.7 ms    [User: 887.2 ms, System: 446.0 ms]
  Range (min … max):   962.3 ms … 1003.4 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     107.9 ms ±   1.3 ms    [User: 81.1 ms, System: 34.2 ms]
  Range (min … max):   105.6 ms … 110.3 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      61.7 ms ±   1.7 ms    [User: 46.1 ms, System: 48.4 ms]
  Range (min … max):    60.1 ms …  66.6 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.6 ms ±   0.6 ms    [User: 30.0 ms, System: 19.0 ms]
  Range (min … max):    45.7 ms …  47.9 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.8 ms ±   0.5 ms    [User: 10.0 ms, System: 6.8 ms]
  Range (min … max):    16.0 ms …  18.7 ms    20 runs

Summary
  tsv ran
    2.78 ± 0.10 times faster than tsv-npm
    3.68 ± 0.16 times faster than oxfmt
    6.44 ± 0.22 times faster than biome
   58.26 ± 1.97 times faster than prettier+oxc-parser
   96.66 ± 3.53 times faster than prettier

Memory Usage:
  prettier: 306.1 MB (min: 292.7 MB, max: 327.1 MB, 22.79 ± 0.61 times more than tsv)
  prettier+oxc-parser: 196.8 MB (min: 193.4 MB, max: 198.4 MB, 14.65 ± 0.16 times more than tsv)
  biome: 94.5 MB (min: 92.9 MB, max: 97.2 MB, 7.04 ± 0.10 times more than tsv)
  oxfmt: 114.0 MB (min: 113.8 MB, max: 114.4 MB, 8.49 ± 0.07 times more than tsv)
  tsv-npm: 49.3 MB (min: 47.3 MB, max: 49.6 MB, 3.67 ± 0.05 times more than tsv)
  tsv: 13.4 MB (min: 13.2 MB, max: 13.6 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run

Benchmark 1: prettier
  Time (mean ± σ):     11.877 s ±  0.221 s    [User: 19.946 s, System: 1.438 s]
  Range (min … max):   11.511 s … 12.202 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.650 s ±  0.222 s    [User: 12.603 s, System: 0.726 s]
  Range (min … max):    9.263 s …  9.911 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     412.3 ms ±   1.0 ms    [User: 3159.0 ms, System: 294.6 ms]
  Range (min … max):   411.1 ms … 414.2 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     140.8 ms ±   1.8 ms    [User: 745.3 ms, System: 321.9 ms]
  Range (min … max):   138.5 ms … 144.5 ms    10 runs

Summary
  oxfmt ran
    2.93 ± 0.04 times faster than biome
   68.54 ± 1.80 times faster than prettier+oxc-parser
   84.37 ± 1.89 times faster than prettier

Memory Usage:
  prettier: 481.4 MB (min: 381.4 MB, max: 673.9 MB, 2.07 ± 0.37 times more than oxfmt)
  prettier+oxc-parser: 327.7 MB (min: 312.6 MB, max: 353.1 MB, 1.41 ± 0.07 times more than oxfmt)
  biome: 182.4 MB (min: 179.4 MB, max: 185.3 MB, 0.79 ± 0.02 times more than oxfmt)
  oxfmt: 232.2 MB (min: 223.9 MB, max: 239.4 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.878 s ±  0.492 s    [User: 57.801 s, System: 6.831 s]
  Range (min … max):   51.454 s … 52.417 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      8.172 s ±  0.121 s    [User: 84.613 s, System: 6.102 s]
  Range (min … max):    8.074 s …  8.308 s    3 runs

Summary
  oxfmt ran
    6.35 ± 0.11 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1663.2 MB (min: 1558.7 MB, max: 1786.0 MB, 3.96 ± 0.32 times more than oxfmt)
  oxfmt: 420.0 MB (min: 400.9 MB, max: 434.6 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.673 s ±  0.270 s    [User: 33.940 s, System: 2.205 s]
  Range (min … max):   25.465 s … 25.978 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.192 s ±  0.163 s    [User: 30.073 s, System: 3.079 s]
  Range (min … max):    3.064 s …  3.376 s    3 runs

Summary
  oxfmt ran
    8.04 ± 0.42 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 718.7 MB (min: 652.9 MB, max: 754.4 MB, 2.41 ± 0.21 times more than oxfmt)
  oxfmt: 298.1 MB (min: 291.1 MB, max: 309.6 MB)

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
  Time (mean ± σ):      8.325 s ±  0.072 s    [User: 13.874 s, System: 0.907 s]
  Range (min … max):    8.228 s …  8.431 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.864 s ±  0.087 s    [User: 8.825 s, System: 0.540 s]
  Range (min … max):    6.712 s …  6.985 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     299.9 ms ±   1.4 ms    [User: 2173.5 ms, System: 226.4 ms]
  Range (min … max):   298.2 ms … 302.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     116.0 ms ±   2.5 ms    [User: 530.1 ms, System: 274.0 ms]
  Range (min … max):   112.6 ms … 119.8 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      76.0 ms ±   0.7 ms    [User: 289.7 ms, System: 130.2 ms]
  Range (min … max):    75.3 ms …  77.6 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      45.2 ms ±   0.3 ms    [User: 269.2 ms, System: 115.5 ms]
  Range (min … max):    44.8 ms …  45.8 ms    10 runs

Summary
  tsv ran
    1.68 ± 0.02 times faster than tsv-npm
    2.57 ± 0.06 times faster than oxfmt
    6.64 ± 0.05 times faster than biome
  151.91 ± 2.16 times faster than prettier+oxc-parser
  184.25 ± 1.98 times faster than prettier

Memory Usage:
  prettier: 478.3 MB (min: 397.1 MB, max: 535.2 MB, 23.13 ± 2.20 times more than tsv)
  prettier+oxc-parser: 303.9 MB (min: 299.2 MB, max: 308.4 MB, 14.69 ± 0.49 times more than tsv)
  biome: 144.8 MB (min: 141.7 MB, max: 146.6 MB, 7.00 ± 0.24 times more than tsv)
  oxfmt: 226.0 MB (min: 219.5 MB, max: 232.3 MB, 10.92 ± 0.39 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.9 MB, 2.40 ± 0.08 times more than tsv)
  tsv: 20.7 MB (min: 19.7 MB, max: 21.7 MB)

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
  Time (mean ± σ):     189.1 ms ±  11.6 ms    [User: 833.7 ms, System: 705.8 ms]
  Range (min … max):   176.0 ms … 212.9 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      71.7 ms ±   1.2 ms    [User: 244.3 ms, System: 143.4 ms]
  Range (min … max):    70.5 ms …  74.2 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      41.1 ms ±   0.4 ms    [User: 226.6 ms, System: 126.8 ms]
  Range (min … max):    40.6 ms …  42.2 ms    10 runs

Summary
  tsv ran
    1.75 ± 0.04 times faster than tsv-npm
    4.61 ± 0.29 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 134.0 MB (min: 121.3 MB, max: 147.3 MB, 10.28 ± 0.67 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.8 MB, 3.80 ± 0.11 times more than tsv)
  tsv: 13.0 MB (min: 12.5 MB, max: 13.7 MB)

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
  Time (mean ± σ):     152.0 ms ±   3.3 ms    [User: 321.8 ms, System: 56.4 ms]
  Range (min … max):   146.9 ms … 160.3 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      47.5 ms ±   1.1 ms    [User: 32.8 ms, System: 17.0 ms]
  Range (min … max):    45.9 ms …  50.1 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      16.9 ms ±   0.2 ms    [User: 11.2 ms, System: 5.7 ms]
  Range (min … max):    16.5 ms …  17.5 ms    20 runs

Summary
  tsv ran
    2.81 ± 0.08 times faster than tsv-npm
    8.99 ± 0.24 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 116.5 MB (min: 112.7 MB, max: 119.8 MB, 8.72 ± 0.18 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.8 MB, 3.71 ± 0.03 times more than tsv)
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
