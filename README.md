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

- **Prettier**: 3.9.9
- **@prettier/plugin-oxc**: 0.2.3
- **Biome**: 2.5.15
- **Oxfmt**: 0.72.0
- **rsvelte-fmt**: 0.7.25
- **tsv**: 0.7.0 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.7.0
- **Node**: 24.14.1
- **Bun**: 1.4.3

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
  Time (mean ± σ):      1.607 s ±  0.017 s    [User: 1.527 s, System: 0.882 s]
  Range (min … max):    1.577 s …  1.646 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     975.3 ms ±  10.7 ms    [User: 888.3 ms, System: 443.1 ms]
  Range (min … max):   954.5 ms … 994.8 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):     106.9 ms ±   0.8 ms    [User: 79.1 ms, System: 35.0 ms]
  Range (min … max):   105.3 ms … 108.7 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      61.0 ms ±   1.4 ms    [User: 44.9 ms, System: 48.5 ms]
  Range (min … max):    59.2 ms …  64.5 ms    20 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      46.5 ms ±   0.9 ms    [User: 32.3 ms, System: 16.6 ms]
  Range (min … max):    45.0 ms …  48.3 ms    20 runs

Benchmark 6: tsv
  Time (mean ± σ):      16.3 ms ±   0.4 ms    [User: 8.3 ms, System: 7.9 ms]
  Range (min … max):    15.4 ms …  16.9 ms    20 runs

Summary
  tsv ran
    2.85 ± 0.09 times faster than tsv-npm
    3.74 ± 0.12 times faster than oxfmt
    6.56 ± 0.16 times faster than biome
   59.88 ± 1.53 times faster than prettier+oxc-parser
   98.69 ± 2.50 times faster than prettier

Memory Usage:
  prettier: 305.9 MB (min: 293.8 MB, max: 318.9 MB, 22.59 ± 0.55 times more than tsv)
  prettier+oxc-parser: 196.7 MB (min: 194.5 MB, max: 198.3 MB, 14.53 ± 0.16 times more than tsv)
  biome: 96.2 MB (min: 94.1 MB, max: 98.6 MB, 7.10 ± 0.13 times more than tsv)
  oxfmt: 112.0 MB (min: 111.8 MB, max: 112.2 MB, 8.27 ± 0.09 times more than tsv)
  tsv-npm: 49.5 MB (min: 49.2 MB, max: 49.8 MB, 3.65 ± 0.04 times more than tsv)
  tsv: 13.5 MB (min: 13.3 MB, max: 13.8 MB)

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
  Time (mean ± σ):     11.631 s ±  0.068 s    [User: 19.763 s, System: 1.369 s]
  Range (min … max):   11.522 s … 11.726 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.409 s ±  0.140 s    [User: 12.255 s, System: 0.721 s]
  Range (min … max):    9.248 s …  9.627 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     405.5 ms ±   2.0 ms    [User: 3070.8 ms, System: 298.8 ms]
  Range (min … max):   402.4 ms … 408.8 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     139.8 ms ±   2.9 ms    [User: 738.2 ms, System: 313.1 ms]
  Range (min … max):   136.2 ms … 146.1 ms    10 runs

Summary
  oxfmt ran
    2.90 ± 0.06 times faster than biome
   67.31 ± 1.72 times faster than prettier+oxc-parser
   83.20 ± 1.79 times faster than prettier

Memory Usage:
  prettier: 461.6 MB (min: 408.9 MB, max: 506.8 MB, 1.98 ± 0.14 times more than oxfmt)
  prettier+oxc-parser: 326.0 MB (min: 308.2 MB, max: 348.8 MB, 1.40 ± 0.07 times more than oxfmt)
  biome: 184.4 MB (min: 180.9 MB, max: 189.7 MB, 0.79 ± 0.02 times more than oxfmt)
  oxfmt: 233.6 MB (min: 224.0 MB, max: 241.4 MB)

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
  Time (mean ± σ):     51.442 s ±  0.305 s    [User: 57.374 s, System: 6.797 s]
  Range (min … max):   51.092 s … 51.651 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      2.778 s ±  0.019 s    [User: 27.721 s, System: 2.811 s]
  Range (min … max):    2.757 s …  2.795 s    3 runs

Summary
  oxfmt ran
   18.51 ± 0.17 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1667.7 MB (min: 1615.9 MB, max: 1748.6 MB, 6.13 ± 0.32 times more than oxfmt)
  oxfmt: 272.1 MB (min: 262.6 MB, max: 277.4 MB)

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
  Time (mean ± σ):     25.258 s ±  0.017 s    [User: 33.452 s, System: 2.230 s]
  Range (min … max):   25.239 s … 25.274 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      2.216 s ±  0.089 s    [User: 21.493 s, System: 2.687 s]
  Range (min … max):    2.155 s …  2.319 s    3 runs

Summary
  oxfmt ran
   11.40 ± 0.46 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 668.3 MB (min: 654.2 MB, max: 686.7 MB, 2.93 ± 0.22 times more than oxfmt)
  oxfmt: 227.8 MB (min: 211.7 MB, max: 243.5 MB)

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
  Time (mean ± σ):      8.153 s ±  0.065 s    [User: 13.651 s, System: 0.903 s]
  Range (min … max):    8.060 s …  8.260 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.763 s ±  0.045 s    [User: 8.657 s, System: 0.571 s]
  Range (min … max):    6.710 s …  6.844 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     295.8 ms ±   2.3 ms    [User: 2125.1 ms, System: 212.6 ms]
  Range (min … max):   293.2 ms … 300.6 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     116.4 ms ±   2.3 ms    [User: 522.5 ms, System: 284.1 ms]
  Range (min … max):   112.9 ms … 120.2 ms    10 runs

Benchmark 5: tsv-npm
  Time (mean ± σ):      75.4 ms ±   0.8 ms    [User: 265.7 ms, System: 146.7 ms]
  Range (min … max):    74.3 ms …  76.6 ms    10 runs

Benchmark 6: tsv
  Time (mean ± σ):      44.7 ms ±   0.5 ms    [User: 250.8 ms, System: 128.2 ms]
  Range (min … max):    43.8 ms …  45.3 ms    10 runs

Summary
  tsv ran
    1.69 ± 0.03 times faster than tsv-npm
    2.60 ± 0.06 times faster than oxfmt
    6.62 ± 0.09 times faster than biome
  151.36 ± 1.94 times faster than prettier+oxc-parser
  182.46 ± 2.48 times faster than prettier

Memory Usage:
  prettier: 454.0 MB (min: 396.2 MB, max: 514.4 MB, 22.17 ± 2.00 times more than tsv)
  prettier+oxc-parser: 303.0 MB (min: 300.4 MB, max: 306.4 MB, 14.80 ± 0.46 times more than tsv)
  biome: 147.8 MB (min: 145.3 MB, max: 150.5 MB, 7.22 ± 0.23 times more than tsv)
  oxfmt: 226.4 MB (min: 220.9 MB, max: 234.1 MB, 11.06 ± 0.39 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.2 MB, max: 49.9 MB, 2.42 ± 0.07 times more than tsv)
  tsv: 20.5 MB (min: 19.5 MB, max: 21.4 MB)

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
  Time (mean ± σ):     163.3 ms ±   3.5 ms    [User: 627.2 ms, System: 641.6 ms]
  Range (min … max):   157.5 ms … 167.6 ms    10 runs

Benchmark 2: tsv-npm
  Time (mean ± σ):      56.0 ms ±   1.1 ms    [User: 163.2 ms, System: 83.0 ms]
  Range (min … max):    54.7 ms …  58.6 ms    10 runs

Benchmark 3: tsv
  Time (mean ± σ):      25.4 ms ±   0.3 ms    [User: 140.8 ms, System: 72.8 ms]
  Range (min … max):    24.9 ms …  25.8 ms    10 runs

Summary
  tsv ran
    2.20 ± 0.05 times faster than tsv-npm
    6.43 ± 0.15 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 153.0 MB (min: 141.5 MB, max: 161.4 MB, 12.54 ± 0.57 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.4 MB, max: 49.7 MB, 4.07 ± 0.10 times more than tsv)
  tsv: 12.2 MB (min: 11.9 MB, max: 12.8 MB)

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
  Time (mean ± σ):      95.9 ms ±   2.0 ms    [User: 472.8 ms, System: 74.5 ms]
  Range (min … max):    92.1 ms …  99.8 ms    20 runs

Benchmark 2: tsv-wasm
  Time (mean ± σ):     157.5 ms ±   3.6 ms    [User: 389.6 ms, System: 51.4 ms]
  Range (min … max):   150.9 ms … 164.1 ms    20 runs

Benchmark 3: tsv-npm
  Time (mean ± σ):      46.8 ms ±   1.3 ms    [User: 32.2 ms, System: 16.8 ms]
  Range (min … max):    45.1 ms …  51.2 ms    20 runs

Benchmark 4: tsv-npm-bun
  Time (mean ± σ):      26.0 ms ±   0.3 ms    [User: 16.4 ms, System: 11.1 ms]
  Range (min … max):    25.6 ms …  26.6 ms    20 runs

Benchmark 5: tsv
  Time (mean ± σ):      16.4 ms ±   0.3 ms    [User: 9.1 ms, System: 7.3 ms]
  Range (min … max):    15.8 ms …  17.0 ms    20 runs

Summary
  tsv ran
    1.58 ± 0.04 times faster than tsv-npm-bun
    2.85 ± 0.10 times faster than tsv-npm
    5.84 ± 0.17 times faster than tsv-wasm-bun
    9.59 ± 0.29 times faster than tsv-wasm

Memory Usage:
  tsv-wasm-bun: 127.1 MB (min: 122.3 MB, max: 132.1 MB, 9.36 ± 0.21 times more than tsv)
  tsv-wasm: 122.1 MB (min: 117.9 MB, max: 125.6 MB, 8.99 ± 0.19 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.1 MB, max: 49.9 MB, 3.65 ± 0.04 times more than tsv)
  tsv-npm-bun: 20.4 MB (min: 20.1 MB, max: 20.6 MB, 1.50 ± 0.02 times more than tsv)
  tsv: 13.6 MB (min: 13.2 MB, max: 13.8 MB)

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
