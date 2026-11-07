# JavaScript/TypeScript Formatter Benchmark

This is a fork of [oxc-project/bench-formatter](https://github.com/oxc-project/bench-formatter)
with [tsv](https://github.com/fuzdev/tsv) added.
Comparing execution time and memory usage of **Prettier**, **Biome**, **Oxfmt**, and **Bun**'s formatter with **tsv** and **rsvelte-fmt**.

> **About this fork.** It adds [tsv](https://tsv.fuz.dev) — a native-Rust formatter for the JS/TS family, CSS, and Svelte — and two more formatters to face it, Bun's built-in `bun fmt` and rsvelte-fmt, plus three scenarios and a set of guards against silently unfair comparisons. Upstream's own scenarios gain those guards and `bench-large-single-file` the tsv rows, and are otherwise changed little; [CLAUDE.md](CLAUDE.md) lists every deviation and the full methodology.
>
> - **tsv has no JSX/TSX parser**, so it runs only on JSX-free corpora: `bench-large-single-file` (`parser.ts`) and the fork-added `bench-ts-only` (Outline's non-JSX JS/TS files, every formatter scoped to that same set) and `bench-svelte`, plus the tsv-only `bench-tsv-delivery`.
> - **`bench-svelte`** puts tsv against [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`) and Bun's formatter on a third-party `.svelte` corpus (Bun's, like `tsv`, is a native executable with no launcher in front); rsvelte-fmt's time includes the oxfmt it launches for non-`.svelte` files, which walks the corpus and finds none. That launch and its Node launcher are fixed cost, and about half of rsvelte-fmt's row at this corpus size: on a one-file directory it takes ~85 ms, where `tsv-npm` takes ~33 ms and `tsv` ~2 ms. So the ratios here move with the size of the corpus as much as with the formatters, and `tsv-npm`, which pays a launch of its own, is the row to read against it. rsvelte-fmt 0.7.x aborts (SIGABRT) when its check output and stderr share one pipe — its Node-run oxfmt leg leaves that pipe non-blocking and a full write panics — so preflight merges each check's output into a file rather than a pipe; the timed runs were never exposed. Should a run still abort, it publishes as-is, abort line included.
> - **`bench-tsv-delivery`** asks a different question — what each way of _installing_ tsv costs — so only tsv's own rows appear in it.
> - **Reading the numbers:** they measure the whole CLI — process spawn, I/O, and each tool's own multi-file parallelism — not the engine, so the ratios move with the core count of the machine named under [Versions](#versions).

## Formatters

- [Prettier](https://prettier.io/)
- [Prettier](https://prettier.io/) + @prettier/plugin-oxc
- [Biome](https://biomejs.dev/) Formatter
- [Oxfmt](https://oxc.rs)
- [rsvelte-fmt](https://github.com/baseballyama/rsvelte) (`@rsvelte/fmt`, Svelte scenario only)
- [Bun](https://bun.sh/)'s built-in formatter (`bun fmt`, the `bun-fmt` row; new in Bun 1.4.4), in the three scenarios where tsv faces other formatters, configured from the same Prettier config as the Prettier row and run as the pinned `bun` devDependency's binary, with no Node in front
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
The exception is `bun-fmt`: `bun fmt` runs as the Bun binary itself, with no
Node in front of it, so `tsv` is its counterpart.
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
  - `.svelte` files from seven third-party sources (layerchart, svelte-ux, flowbite-svelte's `src/lib`, layercake, svelte.dev, svelte-maplibre, and a handful from SvelteKit), read from [fuzdev/corpora](https://github.com/fuzdev/corpora) at a pinned commit (fork-added)
  - `parser.ts` again for the tsv delivery comparison — one file, so every row is single-threaded (fork-added)
- **Methodology**:
  - Multiple warmup runs before measurement
  - Multiple benchmark runs for statistical accuracy
  - Git reset before each run to ensure identical starting conditions
  - Memory usage measured using GNU time (peak RSS)
  - Local binaries via `./node_modules/.bin/`
- **Methodology added by this fork**:
  - tsv is the native binary inside `@fuzdev/tsv`'s platform package (or `TSV_BIN`, for a local build), not a `.bin/` entry. That binary is profile-guided, as released; a plain local build formats slower than it. `tsv-npm` and `tsv-wasm` run through bin shims the harness copies from pnpm's own — both packages claim the `tsv` bin name and pnpm links only one — so they pay the same ~3 ms shell shim as every other `.bin/` row. That levels `tsv-npm` with the other npm-bin rows; it is a tenth of the gap between `tsv-npm` and `tsv`, not the explanation for it
  - tsv is non-configurable (width 100, tabs, single quotes, no trailing commas), so every formatter compared against it is pinned to that style: equal break decisions and equal output volume, at the cost of taking each tool off its defaults
  - `bun-fmt` is held to the style and scope it is given: its command names the Prettier row's config and ignore file and passes flags that stop a `bunfig.toml`, an `.editorconfig`, or a `fmt` script in the corpus or its parents from changing what it does (CLAUDE.md lists each one and why)
  - Every scenario runs a preflight check first and aborts rather than time an unequal comparison: if any formatter rejects a file, if the file counts the formatters report differ, if one has nothing to change (a mis-scoped tool that formats nothing would post an unbeatable time), or if a formatter's check crashes or can't be read at all. Upstream instead passes hyperfine `--ignore-failure`, which times a formatter that errored on part of the corpus as though it had done the work; no scenario here does. A self-test (`pnpm run preflight-selftest`, also run before the suite) verifies preflight can still read each formatter's output, so an upgrade can't silently turn the guard into a no-op
  - Where one formatter rejects files another formats, they are removed for all of them before each run, and the scenario says so in its header: on Storybook, two test fixtures named `.cjs` and written as ES modules (Oxfmt refuses them); on Continue, three declaration files (one both tools reject, two that Prettier's sort-imports plugin refuses). The preflight line under that header, "all formatters accept the whole corpus; nothing excluded", describes the corpus after the removal. In `bench-js-no-embedded` Oxfmt's ignore patterns are tightened to the JS/TS/JSX/TSX set the other three are scoped to — upstream's also took `.mjs`
  - `pnpm run preflight` runs those checks alone, in a few minutes: the thing to run after upgrading a formatter or moving a corpus pin, which are the only two things that change what a formatter accepts
  - hyperfine runs the formatters in the order listed, never interleaved, so on a machine that throttles, later rows run warmer. The tsv scenarios idle 10 s before each formatter to narrow that drift; tsv runs last in them, so what remains biases against it
  - Peak RSS is the largest single process in a command's tree, not the sum, so a Node launcher and the native binary it spawns are never added together: Biome's and rsvelte-fmt's rows are their binary without the ~45 MB launcher, and tsv-npm's row _is_ its launcher, whatever tsv uses under it. The single-process rows — Prettier, Oxfmt, `bun-fmt`, `tsv`, and the WASM rows — are whole
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
- **tsv**: 0.8.1 (@fuzdev/tsv-linux-x64-gnu)
- **tsv-wasm**: 0.8.1
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
  bun-fmt: clean (1 file, 1 would change)
  tsv-npm: clean (1 file, 1 would change)
  tsv: clean (1 file, 1 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      1.596 s ±  0.023 s    [User: 1.540 s, System: 0.865 s]
  Range (min … max):    1.558 s …  1.637 s    20 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):     963.0 ms ±  14.1 ms    [User: 884.4 ms, System: 437.7 ms]
  Range (min … max):   933.8 ms … 987.1 ms    20 runs

Benchmark 3: biome
  Time (mean ± σ):      91.5 ms ±   1.5 ms    [User: 63.0 ms, System: 36.4 ms]
  Range (min … max):    89.5 ms …  95.6 ms    20 runs

Benchmark 4: oxfmt
  Time (mean ± σ):      57.3 ms ±   1.8 ms    [User: 46.9 ms, System: 44.5 ms]
  Range (min … max):    55.3 ms …  62.5 ms    20 runs

Benchmark 5: bun-fmt
  Time (mean ± σ):      14.9 ms ±   0.3 ms    [User: 7.5 ms, System: 7.5 ms]
  Range (min … max):    14.3 ms …  15.5 ms    20 runs

Benchmark 6: tsv-npm
  Time (mean ± σ):      45.1 ms ±   1.0 ms    [User: 30.4 ms, System: 17.3 ms]
  Range (min … max):    43.4 ms …  46.6 ms    20 runs

Benchmark 7: tsv
  Time (mean ± σ):      15.0 ms ±   0.6 ms    [User: 8.7 ms, System: 6.3 ms]
  Range (min … max):    13.8 ms …  16.3 ms    20 runs

Summary
  bun-fmt ran
    1.01 ± 0.04 times faster than tsv
    3.03 ± 0.09 times faster than tsv-npm
    3.85 ± 0.14 times faster than oxfmt
    6.16 ± 0.15 times faster than biome
   64.77 ± 1.55 times faster than prettier+oxc-parser
  107.34 ± 2.54 times faster than prettier

Memory Usage:
  prettier: 306.6 MB (min: 294.4 MB, max: 322.8 MB, 21.19 ± 0.61 times more than tsv)
  prettier+oxc-parser: 197.0 MB (min: 193.9 MB, max: 198.7 MB, 13.61 ± 0.16 times more than tsv)
  biome: 101.8 MB (min: 100.4 MB, max: 104.5 MB, 7.04 ± 0.12 times more than tsv)
  oxfmt: 104.4 MB (min: 104.1 MB, max: 104.6 MB, 7.21 ± 0.08 times more than tsv)
  bun-fmt: 23.7 MB (min: 23.2 MB, max: 23.9 MB, 1.63 ± 0.02 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.4 MB, max: 50.0 MB, 3.43 ± 0.04 times more than tsv)
  tsv: 14.5 MB (min: 14.2 MB, max: 14.7 MB)

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
  Time (mean ± σ):     12.054 s ±  0.176 s    [User: 20.332 s, System: 1.303 s]
  Range (min … max):   11.739 s … 12.322 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      9.770 s ±  0.157 s    [User: 12.620 s, System: 0.747 s]
  Range (min … max):    9.486 s …  9.980 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     281.2 ms ±   2.9 ms    [User: 2192.1 ms, System: 311.1 ms]
  Range (min … max):   277.7 ms … 287.8 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     128.5 ms ±   2.9 ms    [User: 622.7 ms, System: 292.0 ms]
  Range (min … max):   124.0 ms … 133.1 ms    10 runs

Summary
  oxfmt ran
    2.19 ± 0.05 times faster than biome
   76.01 ± 2.12 times faster than prettier+oxc-parser
   93.77 ± 2.53 times faster than prettier

Memory Usage:
  prettier: 455.3 MB (min: 386.1 MB, max: 551.2 MB, 2.30 ± 0.27 times more than oxfmt)
  prettier+oxc-parser: 325.7 MB (min: 313.6 MB, max: 347.9 MB, 1.65 ± 0.08 times more than oxfmt)
  biome: 193.8 MB (min: 191.4 MB, max: 195.7 MB, 0.98 ± 0.03 times more than oxfmt)
  oxfmt: 197.8 MB (min: 190.9 MB, max: 208.9 MB)

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
  Time (mean ± σ):     52.191 s ±  0.155 s    [User: 57.936 s, System: 6.802 s]
  Range (min … max):   52.025 s … 52.333 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      2.783 s ±  0.049 s    [User: 27.379 s, System: 2.889 s]
  Range (min … max):    2.729 s …  2.822 s    3 runs

Summary
  oxfmt ran
   18.75 ± 0.33 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 1756.3 MB (min: 1747.9 MB, max: 1771.6 MB, 6.51 ± 0.23 times more than oxfmt)
  oxfmt: 269.7 MB (min: 259.4 MB, max: 277.4 MB)

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
  Time (mean ± σ):     25.838 s ±  0.186 s    [User: 34.185 s, System: 2.203 s]
  Range (min … max):   25.682 s … 26.044 s    3 runs

Benchmark 2: oxfmt
  Time (mean ± σ):      2.273 s ±  0.060 s    [User: 22.199 s, System: 2.549 s]
  Range (min … max):    2.208 s …  2.325 s    3 runs

Summary
  oxfmt ran
   11.37 ± 0.31 times faster than prettier+oxc-parser

Memory Usage:
  prettier+oxc-parser: 688.0 MB (min: 651.6 MB, max: 754.6 MB, 3.28 ± 0.29 times more than oxfmt)
  oxfmt: 210.0 MB (min: 204.1 MB, max: 213.9 MB)

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
  bun-fmt: clean (1648 files, 1644 would change)
  tsv-npm: clean (1648 files, 1644 would change)
  tsv: clean (1648 files, 1644 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: prettier
  Time (mean ± σ):      8.454 s ±  0.114 s    [User: 13.907 s, System: 0.853 s]
  Range (min … max):    8.273 s …  8.605 s    10 runs

Benchmark 2: prettier+oxc-parser
  Time (mean ± σ):      6.948 s ±  0.079 s    [User: 8.835 s, System: 0.605 s]
  Range (min … max):    6.767 s …  7.053 s    10 runs

Benchmark 3: biome
  Time (mean ± σ):     211.0 ms ±   2.3 ms    [User: 1499.8 ms, System: 241.5 ms]
  Range (min … max):   208.5 ms … 215.5 ms    10 runs

Benchmark 4: oxfmt
  Time (mean ± σ):     104.7 ms ±   2.1 ms    [User: 433.5 ms, System: 245.4 ms]
  Range (min … max):   101.9 ms … 107.7 ms    10 runs

Benchmark 5: bun-fmt
  Time (mean ± σ):      66.7 ms ±   0.6 ms    [User: 311.9 ms, System: 281.2 ms]
  Range (min … max):    65.7 ms …  67.8 ms    10 runs

Benchmark 6: tsv-npm
  Time (mean ± σ):      69.5 ms ±   1.1 ms    [User: 230.1 ms, System: 135.1 ms]
  Range (min … max):    67.7 ms …  70.8 ms    10 runs

Benchmark 7: tsv
  Time (mean ± σ):      39.3 ms ±   0.3 ms    [User: 197.6 ms, System: 133.6 ms]
  Range (min … max):    38.9 ms …  39.7 ms    10 runs

Summary
  tsv ran
    1.70 ± 0.02 times faster than bun-fmt
    1.77 ± 0.03 times faster than tsv-npm
    2.66 ± 0.06 times faster than oxfmt
    5.37 ± 0.07 times faster than biome
  176.73 ± 2.37 times faster than prettier+oxc-parser
  215.03 ± 3.27 times faster than prettier

Memory Usage:
  prettier: 456.1 MB (min: 396.4 MB, max: 541.8 MB, 21.52 ± 1.91 times more than tsv)
  prettier+oxc-parser: 303.9 MB (min: 300.2 MB, max: 310.6 MB, 14.34 ± 0.36 times more than tsv)
  biome: 154.8 MB (min: 151.6 MB, max: 158.4 MB, 7.30 ± 0.20 times more than tsv)
  oxfmt: 192.9 MB (min: 183.8 MB, max: 201.1 MB, 9.10 ± 0.30 times more than tsv)
  bun-fmt: 49.9 MB (min: 49.6 MB, max: 50.2 MB, 2.35 ± 0.06 times more than tsv)
  tsv-npm: 49.7 MB (min: 49.5 MB, max: 49.8 MB, 2.34 ± 0.05 times more than tsv)
  tsv: 21.2 MB (min: 20.6 MB, max: 21.9 MB)

TypeScript-only (non-JSX subset) benchmark complete!


=========================================
Benchmarking Svelte (tsv vs rsvelte-fmt)
=========================================

Target: third-party .svelte corpus (kit, svelte.dev, layerchart, svelte-ux, flowbite-svelte src/lib, svelte-maplibre, layercake)
Corpus: fuzdev/corpora@52bff709bbd3 (collections tree 98dc2cc10ac5), snapshot ca661af 2026-11-03
- 3 warmup runs, 10 benchmark runs, 10s settle before each formatter
- Git reset before each run
- .svelte only: tsv against rsvelte-fmt and bun-fmt


Preflight (per-formatter parse check):
  rsvelte-fmt: clean (1150 files, 957 would change)
  bun-fmt: clean (1150 files, 958 would change)
  tsv-npm: clean (1150 files, 980 would change)
  tsv: clean (1150 files, 980 would change)
  → all formatters accept the whole corpus; nothing excluded
Benchmark 1: rsvelte-fmt
  Time (mean ± σ):     167.9 ms ±   5.6 ms    [User: 634.9 ms, System: 685.7 ms]
  Range (min … max):   160.2 ms … 178.5 ms    10 runs

Benchmark 2: bun-fmt
  Time (mean ± σ):      61.4 ms ±   1.2 ms    [User: 387.6 ms, System: 187.5 ms]
  Range (min … max):    60.0 ms …  63.9 ms    10 runs

Benchmark 3: tsv-npm
  Time (mean ± σ):      54.7 ms ±   0.6 ms    [User: 135.9 ms, System: 95.5 ms]
  Range (min … max):    53.8 ms …  55.6 ms    10 runs

Benchmark 4: tsv
  Time (mean ± σ):      24.0 ms ±   0.7 ms    [User: 108.4 ms, System: 89.7 ms]
  Range (min … max):    22.8 ms …  24.9 ms    10 runs

Summary
  tsv ran
    2.28 ± 0.07 times faster than tsv-npm
    2.56 ± 0.09 times faster than bun-fmt
    7.01 ± 0.31 times faster than rsvelte-fmt

Memory Usage:
  rsvelte-fmt: 149.5 MB (min: 131.7 MB, max: 161.5 MB, 11.84 ± 0.72 times more than tsv)
  bun-fmt: 52.0 MB (min: 51.6 MB, max: 52.6 MB, 4.12 ± 0.08 times more than tsv)
  tsv-npm: 49.6 MB (min: 49.3 MB, max: 49.8 MB, 3.93 ± 0.08 times more than tsv)
  tsv: 12.6 MB (min: 12.3 MB, max: 13.1 MB)

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
  Time (mean ± σ):     109.0 ms ±   2.8 ms    [User: 593.7 ms, System: 85.7 ms]
  Range (min … max):   105.1 ms … 114.5 ms    20 runs

Benchmark 2: tsv-wasm
  Time (mean ± σ):     172.5 ms ±   5.8 ms    [User: 406.5 ms, System: 66.5 ms]
  Range (min … max):   160.8 ms … 183.3 ms    20 runs

Benchmark 3: tsv-npm
  Time (mean ± σ):      45.5 ms ±   1.2 ms    [User: 31.1 ms, System: 16.8 ms]
  Range (min … max):    43.1 ms …  48.6 ms    20 runs

Benchmark 4: tsv-npm-bun
  Time (mean ± σ):      24.8 ms ±   0.3 ms    [User: 13.0 ms, System: 13.1 ms]
  Range (min … max):    24.3 ms …  25.6 ms    20 runs

Benchmark 5: tsv
  Time (mean ± σ):      15.1 ms ±   0.5 ms    [User: 7.1 ms, System: 8.0 ms]
  Range (min … max):    13.8 ms …  16.0 ms    20 runs

Summary
  tsv ran
    1.64 ± 0.06 times faster than tsv-npm-bun
    3.01 ± 0.13 times faster than tsv-npm
    7.22 ± 0.31 times faster than tsv-wasm-bun
   11.43 ± 0.55 times faster than tsv-wasm

Memory Usage:
  tsv-wasm-bun: 138.3 MB (min: 134.7 MB, max: 144.2 MB, 9.54 ± 0.19 times more than tsv)
  tsv-wasm: 122.1 MB (min: 118.5 MB, max: 127.4 MB, 8.43 ± 0.20 times more than tsv)
  tsv-npm: 49.6 MB (min: 47.7 MB, max: 49.8 MB, 3.42 ± 0.04 times more than tsv)
  tsv-npm-bun: 20.9 MB (min: 20.7 MB, max: 21.1 MB, 1.44 ± 0.01 times more than tsv)
  tsv: 14.5 MB (min: 14.3 MB, max: 14.8 MB)

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
