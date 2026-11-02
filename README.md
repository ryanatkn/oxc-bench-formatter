# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, and **Oxfmt** with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds [tsv](https://tsv.fuz.dev) — a native-Rust formatter for the JS/TS family, CSS, and Svelte — plus three scenarios and a set of guards against silently unfair comparisons. Upstream's own scenarios gain those guards and `bench-large-single-file` the tsv rows, and are otherwise changed little; [CLAUDE.md](CLAUDE.md) lists every deviation and the full methodology.
>
> - **tsv has no JSX/TSX parser**, so it runs only on JSX-free corpora: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only` (Outline's non-JSX JS/TS files, every formatter scoped to that same set) and `bench-svelte`, plus the tsv-only `bench-tsv-delivery`.
> - **`bench-svelte`** puts tsv against [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) on 1,091 third-party `.svelte` files; rsvelte-fmt's time includes the oxfmt it launches for non-`.svelte` files, which walks the corpus and finds none. That launch and its Node launcher are fixed cost, and about half of rsvelte-fmt's row at this corpus size: on a one-file directory it takes ~85 ms, where `tsv-npm` takes ~33 ms and `tsv` ~2 ms. So the ratios here move with the size of the corpus as much as with the formatters, and `tsv-npm`, which pays a launch of its own, is the row to read against it. rsvelte-fmt 0.7.x aborts (SIGABRT) when its check output and stderr share one pipe — its Node-run oxfmt leg leaves that pipe non-blocking and a full write panics — so preflight merges each check's output into a file rather than a pipe; the timed runs were never exposed. Should a run still abort, it publishes as-is, abort line included.
> - **`bench-tsv-delivery`** asks a different question — what each way of _installing_ tsv costs — so only tsv's own rows appear in it.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [tsv](https://tsv.fuz.dev/), as up to five rows — one per way of running it:

| Row                            | What is timed                                                                                                                                                   | Scenarios                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `tsv`                          | the native binary, run directly                                                                                                                                 | every tsv scenario        |
| `tsv-npm`                      | the same binary, started the way an npm install starts it (`npx tsv`, a `package.json` script): `@fuzdev/tsv`'s `tsv` bin, a Node script that spawns the binary | every tsv scenario        |
| `tsv-wasm`                     | the same CLI contract, mirrored in JS over a WASM engine in Node (`@fuzdev/tsv-wasm`) — the package for platforms with no prebuilt binary                       | `bench-tsv-delivery` only |
| `tsv-npm-bun` / `tsv-wasm-bun` | `tsv-npm` and `tsv-wasm` on Bun instead of Node (`bunx --bun tsv`)                                                                                              | `bench-tsv-delivery` only |

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

# Or only check that every formatter still accepts every corpus (nothing timed)
pnpm run preflight

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
  - 1,091 `.svelte` files from seven third-party sources (layerchart, svelte-ux, flowbite-svelte's `src/lib`, layercake, svelte.dev, svelte-maplibre, and a handful from SvelteKit), read from [fuzdev/corpora](https://github.com/fuzdev/corpora) at a pinned commit (fork-added)
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
  - Every scenario runs a preflight check first and aborts rather than time an unequal comparison: if any formatter rejects a file, if the file counts the formatters report differ, if one has nothing to change (a mis-scoped tool that formats nothing would post an unbeatable time), or if a formatter's check crashes or can't be read at all. Upstream instead passes hyperfine `--ignore-failure`, which times a formatter that errored on part of the corpus as though it had done the work; no scenario here does. A self-test (`pnpm run preflight-selftest`, also run before the suite) verifies preflight can still read each formatter's output, so an upgrade can't silently turn the guard into a no-op
  - Where one formatter rejects files another formats, they are removed for all of them before each run, and the scenario says so in its header: on Storybook, two test fixtures named `.cjs` and written as ES modules (Oxfmt refuses them); on Continue, three declaration files (one both tools reject, two that Prettier's sort-imports plugin refuses). The preflight line under that header, "all formatters accept the whole corpus; nothing excluded", describes the corpus after the removal. In `bench-js-no-embedded` Oxfmt's ignore patterns are tightened to the JS/TS/JSX/TSX set the other three are scoped to — upstream's also took `.mjs`
  - `pnpm run preflight` runs those checks alone, in a few minutes: the thing to run after upgrading a formatter or moving a corpus pin, which are the only two things that change what a formatter accepts
  - hyperfine runs the formatters in the order listed, never interleaved, so on a machine that throttles, later rows run warmer. The tsv scenarios idle 10 s before each formatter to narrow that drift; tsv runs last in them, so what remains biases against it
  - Peak RSS is the largest single process in a command's tree, not the sum, so a Node launcher and the native binary it spawns are never added together: Biome's and rsvelte-fmt's rows are their binary without the ~45 MB launcher, and tsv-npm's row _is_ its launcher, whatever tsv uses under it
  - Memory ratios are taken against a fixed baseline per scenario (tsv where it runs, oxfmt elsewhere), not that run's smallest, so the column stays comparable across regenerations; a ratio below 1 means less than the baseline
  - A memory run that dies from a signal is never averaged in: the scenario aborts on one, as its timed runs do
  - The per-run reset of a git-backed corpus checks every tracked file against the commit by content, not by git's cached stat data: a file rewritten in place at the same size while a reset is under way can leave that data calling it clean, and a plain `git reset --hard` then never restores it
  - One run at a time per checkout: a run holds a lock on it and a second one refuses to start, as does one started beside a hyperfine an earlier run left behind (Linux; elsewhere the run warns that it is unguarded)
  - Each scenario prints the corpus commit (or the file's content hash) it ran against — in the block below and in `results.json` — and the cloned corpora are pinned to fixed commits (`shared/corpus-pins.mjs`), so a rerun formats the same bytes

## Versions

- **Prettier**: 3.9.10
- **@prettier/plugin-oxc**: 0.2.3
- **Biome**: 2.6.4
- **Oxfmt**: 0.75.0
- **rsvelte-fmt**: 0.7.25
- **tsv**: 0.8.0 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.8.0
- **Node**: 24.14.1
- **Bun**: 1.4.4

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
  Time (mean ± σ):      1.586 s ±  0.021 s    [User: 1.544 s, System: 0.848 s]
  Range (min … max):    1.553 s …  1.625 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     961.7 ms ±   9.3 ms    [User: 873.5 ms, System: 443.3 ms]
  Range (min … max):   946.4 ms … 982.7 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):      90.5 ms ±   1.2 ms    [User: 60.8 ms, System: 36.9 ms]
  Range (min … max):    89.0 ms …  93.1 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      57.7 ms ±   1.8 ms    [User: 46.2 ms, System: 45.0 ms]
  Range (min … max):    55.7 ms …  61.2 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.4 ms ±   1.1 ms    [User: 31.6 ms, System: 17.2 ms]
  Range (min … max):    44.8 ms …  48.8 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.2 ms ±   0.3 ms    [User: 8.7 ms, System: 7.6 ms]
  Range (min … max):    15.6 ms …  16.8 ms    20 runs

Summary
  tsv ran
    2.86 ± 0.09 times faster than tsv-npm
    3.55 ± 0.13 times faster than oxfmt
    5.58 ± 0.13 times faster than biome
   59.24 ± 1.30 times faster than prettier+oxc-parser
   97.67 ± 2.30 times faster than prettier

Memory Usage:
  prettier: 304.9 MB (min: 296.3 MB, max: 319.4 MB, 22.36 ± 0.51 times more than tsv)
  prettier+oxc-parser: 196.5 MB (min: 193.3 MB, max: 199.0 MB, 14.41 ± 0.18 times more than tsv)
  biome: 102.3 MB (min: 100.2 MB, max: 104.6 MB, 7.50 ± 0.12 times more than tsv)
  oxfmt: 104.0 MB (min: 103.9 MB, max: 104.2 MB, 7.63 ± 0.07 times more than tsv)
  tsv-npm: 49.2 MB (min: 47.4 MB, max: 49.4 MB, 3.61 ± 0.05 times more than tsv)
  tsv: 13.6 MB (min: 13.5 MB, max: 13.9 MB)

Large single file benchmark complete!


=========================================
Benchmarking JS/TS (no embedded)
=========================================

Target: Outline repository (js/ts/tsx only)
Corpus: 8cf997c 2026-07-14
- 3 warmup runs, 10 benchmark runs
- Git reset before each run


Preflight (per-formatter parse check):
  prettier: clean (2224 would change)
  prettier+oxc-parser: clean (2224 would change)
  biome: clean (2329 files, 2224 would change)
  oxfmt: clean (2329 files, 2224 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):     11.724 s ±  0.117 s    [User: 19.888 s, System: 1.357 s]
  Range (min … max):   11.567 s … 11.938 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.492 s ±  0.252 s    [User: 12.332 s, System: 0.737 s]
  Range (min … max):    9.204 s …  9.883 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     281.1 ms ±   4.0 ms    [User: 2201.9 ms, System: 279.5 ms]
  Range (min … max):   277.0 ms … 290.3 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     126.5 ms ±   3.9 ms    [User: 614.3 ms, System: 290.7 ms]
  Range (min … max):   121.6 ms … 132.9 ms    10 runs

Summary
  oxfmt ran
    2.22 ± 0.08 times faster than biome
   75.03 ± 3.06 times faster than prettier+oxc-parser
   92.66 ± 3.01 times faster than prettier

Memory Usage:
  prettier: 474.0 MB (min: 396.1 MB, max: 585.3 MB, 2.43 ± 0.30 times more than oxfmt)
  prettier+oxc-parser: 333.5 MB (min: 316.9 MB, max: 375.0 MB, 1.71 ± 0.10 times more than oxfmt)
  biome: 193.0 MB (min: 189.6 MB, max: 196.7 MB, 0.99 ± 0.03 times more than oxfmt)
  oxfmt: 194.9 MB (min: 185.4 MB, max: 202.0 MB)

JS/TS (no embedded) benchmark complete!


=========================================
Benchmarking Mixed (embedded)
=========================================

Target: Storybook repository (mixed with embedded languages)
Corpus: 5073688 2026-07-15
- 1 warmup runs, 3 benchmark runs
- Git reset before each run
- 2 files a formatter rejects removed before each run


Preflight (per-formatter parse check):
  prettier+oxc-parser: clean (4678 would change)
  oxfmt: clean (5615 files, 4694 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     51.835 s ±  0.517 s    [User: 57.506 s, System: 6.813 s]
  Range (min … max):   51.252 s … 52.238 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      2.688 s ±  0.011 s    [User: 26.731 s, System: 2.773 s]
  Range (min … max):    2.679 s …  2.700 s    3 runs

Summary
  oxfmt ran
   19.28 ± 0.21 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1708.2 MB (min: 1616.2 MB, max: 1756.2 MB, 6.21 ± 0.37 times more than oxfmt)
  oxfmt: 274.9 MB (min: 268.1 MB, max: 286.8 MB)

Mixed (embedded) benchmark complete!


=========================================
Benchmarking Full features
=========================================

Target: Continue repository (full features)
Corpus: d0a3c0b 2026-06-18
- 1 warmup runs, 3 benchmark runs
- Git reset before each run
- 3 files a formatter rejects removed before each run


Preflight (per-formatter parse check):
  prettier+oxc-parser: clean (2081 would change)
  oxfmt: clean (2312 files, 2079 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier+oxc-parser
  Time (mean ± σ):     25.383 s ±  0.096 s    [User: 33.620 s, System: 2.220 s]
  Range (min … max):   25.283 s … 25.475 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      2.186 s ±  0.054 s    [User: 21.313 s, System: 2.569 s]
  Range (min … max):    2.123 s …  2.220 s    3 runs

Summary
  oxfmt ran
   11.61 ± 0.29 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 686.1 MB (min: 655.3 MB, max: 745.5 MB, 3.20 ± 0.27 times more than oxfmt)
  oxfmt: 214.1 MB (min: 205.8 MB, max: 222.7 MB)

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
  Time (mean ± σ):      8.281 s ±  0.111 s    [User: 13.732 s, System: 0.921 s]
  Range (min … max):    8.154 s …  8.479 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.839 s ±  0.079 s    [User: 8.770 s, System: 0.566 s]
  Range (min … max):    6.711 s …  6.951 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     209.5 ms ±   1.8 ms    [User: 1517.4 ms, System: 213.0 ms]
  Range (min … max):   206.8 ms … 213.1 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     104.3 ms ±   3.2 ms    [User: 438.7 ms, System: 220.8 ms]
  Range (min … max):   100.1 ms … 111.0 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      75.4 ms ±   1.8 ms    [User: 279.9 ms, System: 134.3 ms]
  Range (min … max):    74.2 ms …  80.3 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      44.9 ms ±   0.3 ms    [User: 275.6 ms, System: 108.1 ms]
  Range (min … max):    44.5 ms …  45.4 ms    10 runs

Summary
  tsv ran
    1.68 ± 0.04 times faster than tsv-npm
    2.32 ± 0.07 times faster than oxfmt
    4.66 ± 0.05 times faster than biome
  152.26 ± 2.11 times faster than prettier+oxc-parser
  184.37 ± 2.84 times faster than prettier

Memory Usage:
  prettier: 457.6 MB (min: 366.2 MB, max: 570.2 MB, 22.83 ± 2.88 times more than tsv)
  prettier+oxc-parser: 303.5 MB (min: 298.7 MB, max: 310.7 MB, 15.15 ± 0.45 times more than tsv)
  biome: 154.8 MB (min: 152.3 MB, max: 158.8 MB, 7.72 ± 0.23 times more than tsv)
  oxfmt: 192.1 MB (min: 185.5 MB, max: 198.8 MB, 9.59 ± 0.35 times more than tsv)
  tsv-npm: 49.0 MB (min: 47.4 MB, max: 49.6 MB, 2.44 ± 0.08 times more than tsv)
  tsv: 20.0 MB (min: 19.0 MB, max: 20.8 MB)

TypeScript-only (non-JSX subset) benchmark complete!


=========================================
Benchmarking Svelte (tsv vs rsvelte-fmt)
=========================================

Target: third-party .svelte corpus (kit, svelte.dev, layerchart, svelte-ux, flowbite-svelte src/lib, svelte-maplibre, layercake)
Corpus: fuzdev/corpora@63d1790f2473 (collections tree 9b64dd2a4e21), snapshot ce81fe8 2026-10-02
- 3 warmup runs, 10 benchmark runs, 10s settle before each formatter
- Git reset before each run
- .svelte only: the two Svelte-native formatters head-to-head


Preflight (per-formatter parse check):
  rsvelte-fmt: clean (1091 files, 917 would change)
  tsv-npm: clean (1091 files, 935 would change)
  tsv: clean (1091 files, 935 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: rsvelte-fmt
  Time (mean ± σ):     165.4 ms ±   3.1 ms    [User: 621.7 ms, System: 646.8 ms]
  Range (min … max):   160.4 ms … 170.1 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      56.1 ms ±   0.7 ms    [User: 158.7 ms, System: 87.6 ms]
  Range (min … max):    55.4 ms …  57.4 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      25.5 ms ±   0.3 ms    [User: 141.7 ms, System: 70.3 ms]
  Range (min … max):    25.1 ms …  26.1 ms    10 runs

Summary
  tsv ran
    2.20 ± 0.04 times faster than tsv-npm
    6.49 ± 0.15 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 149.4 MB (min: 129.5 MB, max: 165.7 MB, 12.61 ± 0.98 times more than tsv)
  tsv-npm: 49.4 MB (min: 49.1 MB, max: 49.6 MB, 4.17 ± 0.11 times more than tsv)
  tsv: 11.9 MB (min: 11.2 MB, max: 12.2 MB)

Svelte benchmark complete!


=========================================
Benchmarking tsv Delivery Paths
=========================================

Target: TypeScript compiler parser.ts (~540KB), through each tsv distribution
Corpus: 539588 bytes, sha256:dcddb577aa14
- 3 warmup runs, 20 benchmark runs, 10s settle before each formatter
- Copy original before each run


Preflight (per-formatter parse check):
  tsv-wasm-bun: clean (1 file, 1 would change)
  tsv-wasm: clean (1 file, 1 would change)
  tsv-npm: clean (1 file, 1 would change)
  tsv-npm-bun: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: tsv-wasm-bun
  Time (mean ± σ):     106.2 ms ±   2.7 ms    [User: 580.2 ms, System: 81.8 ms]
  Range (min … max):   101.0 ms … 112.2 ms    20 runs

Benchmark 2: tsv-wasm
  Time (mean ± σ):     173.1 ms ±   4.4 ms    [User: 427.3 ms, System: 54.2 ms]
  Range (min … max):   162.9 ms … 178.6 ms    20 runs

Benchmark 3: tsv-npm
  Time (mean ± σ):      46.7 ms ±   1.0 ms    [User: 32.3 ms, System: 17.0 ms]
  Range (min … max):    45.3 ms …  49.3 ms    20 runs

Benchmark 4: tsv-npm-bun
  Time (mean ± σ):      26.1 ms ±   0.4 ms    [User: 14.3 ms, System: 13.2 ms]
  Range (min … max):    25.0 ms …  27.0 ms    20 runs

Benchmark 5: tsv
  Time (mean ± σ):      16.7 ms ±   0.2 ms    [User: 10.4 ms, System: 6.2 ms]
  Range (min … max):    16.2 ms …  17.2 ms    20 runs

Summary
  tsv ran
    1.56 ± 0.03 times faster than tsv-npm-bun
    2.81 ± 0.07 times faster than tsv-npm
    6.37 ± 0.19 times faster than tsv-wasm-bun
   10.40 ± 0.30 times faster than tsv-wasm

Memory Usage:
  tsv-wasm-bun: 136.1 MB (min: 125.8 MB, max: 143.0 MB, 9.90 ± 0.29 times more than tsv)
  tsv-wasm: 124.7 MB (min: 119.8 MB, max: 128.4 MB, 9.07 ± 0.22 times more than tsv)
  tsv-npm: 49.3 MB (min: 47.3 MB, max: 49.6 MB, 3.58 ± 0.05 times more than tsv)
  tsv-npm-bun: 20.8 MB (min: 20.8 MB, max: 21.0 MB, 1.52 ± 0.02 times more than tsv)
  tsv: 13.8 MB (min: 13.5 MB, max: 14.1 MB)

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
