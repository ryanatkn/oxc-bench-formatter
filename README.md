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
[`results.json`](results.json) — one record per scenario (timings from
hyperfine's own export rather than scraped text, the memory and preflight rows),
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
  - Each scenario prints the corpus commit (or the file's content hash) it ran against, since the cloned corpora track their upstream default branches

## Versions

- **Prettier**: 3.9.6
- **Biome**: 2.5.13
- **Oxfmt**: 0.68.0
- **rsvelte-fmt**: 0.7.23
- **tsv**: 0.4.1 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.4.1

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
  Time (mean ± σ):      1.615 s ±  0.029 s    [User: 1.544 s, System: 0.878 s]
  Range (min … max):    1.561 s …  1.657 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     975.5 ms ±   9.4 ms    [User: 879.9 ms, System: 450.8 ms]
  Range (min … max):   959.4 ms … 1001.2 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     107.4 ms ±   1.4 ms    [User: 80.6 ms, System: 33.9 ms]
  Range (min … max):   105.3 ms … 111.0 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      61.1 ms ±   1.5 ms    [User: 44.7 ms, System: 50.4 ms]
  Range (min … max):    59.5 ms …  64.6 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.9 ms ±   1.1 ms    [User: 30.2 ms, System: 18.9 ms]
  Range (min … max):    45.4 ms …  48.6 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.6 ms ±   0.4 ms    [User: 11.1 ms, System: 5.5 ms]
  Range (min … max):    15.6 ms …  17.3 ms    20 runs

Summary
  tsv ran
    2.82 ± 0.09 times faster than tsv-npm
    3.68 ± 0.12 times faster than oxfmt
    6.47 ± 0.17 times faster than biome
   58.75 ± 1.48 times faster than prettier+oxc-parser
   97.23 ± 2.86 times faster than prettier

Memory Usage:
  prettier: 304.1 MB (min: 291.9 MB, max: 312.5 MB, 22.74 ± 0.49 times more than tsv)
  prettier+oxc-parser: 196.6 MB (min: 193.4 MB, max: 198.7 MB, 14.70 ± 0.18 times more than tsv)
  biome: 95.4 MB (min: 92.9 MB, max: 99.5 MB, 7.13 ± 0.18 times more than tsv)
  oxfmt: 114.0 MB (min: 112.3 MB, max: 114.5 MB, 8.52 ± 0.09 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.3 MB, max: 49.7 MB, 3.70 ± 0.04 times more than tsv)
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
  Time (mean ± σ):     11.921 s ±  0.133 s    [User: 20.058 s, System: 1.420 s]
  Range (min … max):   11.739 s … 12.139 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.661 s ±  0.217 s    [User: 12.602 s, System: 0.719 s]
  Range (min … max):    9.267 s …  9.913 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     415.2 ms ±   2.1 ms    [User: 3171.9 ms, System: 291.9 ms]
  Range (min … max):   413.4 ms … 419.7 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     140.8 ms ±   2.4 ms    [User: 741.4 ms, System: 321.2 ms]
  Range (min … max):   138.1 ms … 146.2 ms    10 runs

Summary
  oxfmt ran
    2.95 ± 0.05 times faster than biome
   68.61 ± 1.93 times faster than prettier+oxc-parser
   84.67 ± 1.72 times faster than prettier

Memory Usage:
  prettier: 453.8 MB (min: 393.3 MB, max: 541.3 MB, 1.96 ± 0.24 times more than oxfmt)
  prettier+oxc-parser: 336.0 MB (min: 312.3 MB, max: 379.5 MB, 1.45 ± 0.09 times more than oxfmt)
  biome: 182.3 MB (min: 179.4 MB, max: 185.4 MB, 0.79 ± 0.02 times more than oxfmt)
  oxfmt: 231.0 MB (min: 223.2 MB, max: 242.6 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.924 s ±  0.167 s    [User: 57.963 s, System: 6.785 s]
  Range (min … max):   51.763 s … 52.097 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      7.885 s ±  0.042 s    [User: 84.392 s, System: 5.834 s]
  Range (min … max):    7.838 s …  7.919 s    3 runs

Summary
  oxfmt ran
    6.59 ± 0.04 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1693.8 MB (min: 1565.7 MB, max: 1763.2 MB, 4.11 ± 0.30 times more than oxfmt)
  oxfmt: 412.5 MB (min: 405.1 MB, max: 427.0 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run

Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.965 s ±  0.172 s    [User: 34.339 s, System: 2.176 s]
  Range (min … max):   25.774 s … 26.108 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      3.171 s ±  0.163 s    [User: 30.521 s, System: 3.016 s]
  Range (min … max):    3.052 s …  3.357 s    3 runs

Summary
  oxfmt ran
    8.19 ± 0.42 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 682.2 MB (min: 641.9 MB, max: 748.9 MB, 2.21 ± 0.20 times more than oxfmt)
  oxfmt: 309.0 MB (min: 302.4 MB, max: 321.4 MB)

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
  Time (mean ± σ):      8.304 s ±  0.085 s    [User: 13.806 s, System: 0.831 s]
  Range (min … max):    8.192 s …  8.448 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.835 s ±  0.093 s    [User: 8.796 s, System: 0.545 s]
  Range (min … max):    6.716 s …  7.032 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     302.8 ms ±   1.4 ms    [User: 2193.0 ms, System: 220.5 ms]
  Range (min … max):   301.1 ms … 305.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     115.7 ms ±   2.4 ms    [User: 530.4 ms, System: 259.8 ms]
  Range (min … max):   112.8 ms … 119.5 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      76.1 ms ±   1.1 ms    [User: 295.8 ms, System: 123.1 ms]
  Range (min … max):    74.4 ms …  78.2 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      45.4 ms ±   0.3 ms    [User: 257.0 ms, System: 127.6 ms]
  Range (min … max):    44.8 ms …  45.9 ms    10 runs

Summary
  tsv ran
    1.67 ± 0.03 times faster than tsv-npm
    2.55 ± 0.06 times faster than oxfmt
    6.66 ± 0.05 times faster than biome
  150.43 ± 2.28 times faster than prettier+oxc-parser
  182.76 ± 2.23 times faster than prettier

Memory Usage:
  prettier: 439.6 MB (min: 383.4 MB, max: 581.1 MB, 21.15 ± 2.80 times more than tsv)
  prettier+oxc-parser: 303.2 MB (min: 299.4 MB, max: 306.0 MB, 14.59 ± 0.38 times more than tsv)
  biome: 145.5 MB (min: 140.5 MB, max: 151.2 MB, 7.00 ± 0.24 times more than tsv)
  oxfmt: 228.8 MB (min: 218.5 MB, max: 238.6 MB, 11.01 ± 0.38 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.4 MB, max: 49.7 MB, 2.38 ± 0.06 times more than tsv)
  tsv: 20.8 MB (min: 20.1 MB, max: 21.9 MB)

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
  Time (mean ± σ):     194.9 ms ±   8.6 ms    [User: 859.9 ms, System: 736.3 ms]
  Range (min … max):   188.1 ms … 217.0 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      71.5 ms ±   0.6 ms    [User: 247.6 ms, System: 138.8 ms]
  Range (min … max):    70.8 ms …  72.5 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      41.1 ms ±   0.4 ms    [User: 229.2 ms, System: 127.1 ms]
  Range (min … max):    40.7 ms …  42.0 ms    10 runs

Summary
  tsv ran
    1.74 ± 0.02 times faster than tsv-npm
    4.74 ± 0.21 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 141.2 MB (min: 131.4 MB, max: 153.3 MB, 10.92 ± 0.61 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.4 MB, max: 49.7 MB, 3.83 ± 0.07 times more than tsv)
  tsv: 12.9 MB (min: 12.6 MB, max: 13.2 MB)

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
  Time (mean ± σ):     151.5 ms ±   4.3 ms    [User: 319.4 ms, System: 59.5 ms]
  Range (min … max):   146.1 ms … 167.4 ms    20 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      47.0 ms ±   0.6 ms    [User: 30.7 ms, System: 18.5 ms]
  Range (min … max):    45.5 ms …  48.1 ms    20 runs

Benchmark 3: tsv
  Time (mean ± σ):      17.0 ms ±   0.5 ms    [User: 9.7 ms, System: 7.2 ms]
  Range (min … max):    16.3 ms …  18.3 ms    20 runs

Summary
  tsv ran
    2.77 ± 0.09 times faster than tsv-npm
    8.93 ± 0.35 times faster than tsv-wasm

Memory Usage:
  tsv-wasm: 117.6 MB (min: 114.0 MB, max: 121.0 MB, 8.81 ± 0.20 times more than tsv)
  tsv-npm: 49.5 MB (min: 47.5 MB, max: 49.8 MB, 3.71 ± 0.05 times more than tsv)
  tsv: 13.3 MB (min: 13.1 MB, max: 13.6 MB)

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
