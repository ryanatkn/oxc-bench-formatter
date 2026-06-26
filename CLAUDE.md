# CLAUDE.md

Navigation aid for this repo. The upstream agent guidance lives in
[AGENTS.md](AGENTS.md) (this file used to be a symlink to it); this file is the
fuller working map, including the tsv integration this fork adds.

## What this is

A benchmark suite comparing JS/TS formatters on **execution time** (via
[hyperfine](https://github.com/sharkdp/hyperfine)) and **peak memory / RSS**
(via GNU `time`). Formatters compared:

- **prettier** (`prettier --write`)
- **prettier+oxc-parser** (prettier with `@prettier/plugin-oxc`)
- **biome** (`biome format --write`)
- **oxfmt** (`oxfmt`)
- **tsv** (`tsv format`) — native Rust, TypeScript/CSS/Svelte only (no JSX/TSX);
  runs only in the `.ts`-only scenarios (`bench-ts-only`,
  `bench-large-single-file`). This is the fork's addition over upstream.

All sources are ESM `.mjs`. No test framework or hand-rolled linter — quality
gating is delegated to **vite-plus** (`vp`): `prepare` runs `vp config`, staged
files run `vp check --fix` (see `vite.config.ts`), and `.vite-hooks/pre-commit`
runs `vp staged`. Package manager is pnpm 11.4.0; Node is `lts/*`.

## Layout

```
bench-formatter/
├── bench-all.mjs                    # run every scenario in sequence (`pnpm run bench`)
├── bench-all-and-update-readme.mjs  # run + scrape output into README (`pnpm run update-readme`)
├── init.sh                          # install deps, clone data repos, download parser.ts, harvest .ts corpus, build tsv
├── shared/utils.mjs                 # the harness: formatter commands + hyperfine + memory
├── bench-large-single-file/         # one scenario per dir (structure below)
├── bench-js-no-embedded/
├── bench-mixed-embedded/
├── bench-full-features/
├── bench-ts-only/                   # .ts-only scenario added by this fork (all 5 formatters incl. tsv)
├── vite.config.ts / pnpm-workspace.yaml  # vite-plus tooling + catalog
└── .github/workflows/               # ci.yml, security, update-readme
```

Each `bench-*/` scenario dir has an identical shape:

```
bench-<name>/
├── bench.mjs           # scenario entry: setupCwd → hyperfine runs → memory runs
├── biome.json          # biome config (sometimes empty when biome isn't run)
├── oxfmtrc.json        # oxfmt config
├── prettierrc.json     # prettier config
├── prettierrc-oxc.json # prettier config for the +oxc-parser variant (only where that variant is benched)
├── prettierignore      # prettier ignore (also used to scope which files are formatted)
└── data/               # test corpus — gitignored; cloned/downloaded or harvested by init.sh
```

## The harness — `shared/utils.mjs`

- **`createFormatters(projectRoot, configDir)`** → `{ prettier, biome, oxfmt, tsv }`
  command builders. The npm binaries resolve at `<projectRoot>/node_modules/.bin/`;
  configs read from `configDir`. Each builder takes the file/dir args:
  - `prettier(files, cfg = "prettierrc.json")` → `… --write --config <dir>/<cfg> --ignore-path <dir>/prettierignore --ignore-unknown`
  - `biome(files)` → `biome format --write --files-ignore-unknown=true --config-path <dir> <files>`
  - `oxfmt(files)` → `oxfmt --config <dir>/oxfmtrc.json <files>`
  - `tsv(files)` → `<tsvBin> format <files>` — the **odd one out**: a native Rust
    binary, not an npm `.bin`. `tsvBin` is `TSV_BIN` or defaults to
    `<projectRoot>/../tsv/target/release/tsv`. No config file or flags (tsv is
    non-configurable); directory args recurse over `.ts`/`.svelte`/`.css` only.
  - Note in the source: do **not** pass prettier `--experimental-cli` (it
    behaves differently from the stable CLI).
- **`runHyperfine(args)`** — spawns `hyperfine` (stdio inherited), resolves on exit 0.
- **`runMemoryBenchmarks(benchmarks, runs)`** / `measureMemory` — runs each
  command under GNU `time -f '%M'` (peak RSS in KB → MB). Auto-detects `gtime`
  then `/usr/bin/time`; `checkGnuTime()` warns and skips memory if neither.
- **`printHeader`**, **`FORMATTER_NAMES`** — display helpers.
- **`setupCwd(import.meta.url)`** — each `bench.mjs` chdirs into its own dir so
  relative config/data paths resolve.

## Scenarios

| Dir                       | Corpus                                                                        | Reset / prepare                                                    | warmup × runs | Formatters run           |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------- | ------------------------ |
| `bench-large-single-file` | TS compiler `parser.ts` (~540KB, v5.9.2)                                      | `cp parser.ts.bak parser.ts`                                       | 2 × 5         | all 5 (incl. tsv)        |
| `bench-js-no-embedded`    | [outline](https://github.com/outline/outline) (js/ts/jsx/tsx)                 | `git reset --hard`                                                 | 3 × 10        | all 4 (no tsv — JSX/TSX) |
| `bench-mixed-embedded`    | [storybook](https://github.com/storybookjs/storybook) (embedded langs)        | `git reset --hard` + rm stray prettier configs                     | 1 × 3         | prettier+oxc, oxfmt      |
| `bench-full-features`     | [continue](https://github.com/continuedev/continue) (sort-imports + tailwind) | `git reset --hard` + strip a tailwind `require` + rm `.prettierrc` | 1 × 3         | prettier+oxc, oxfmt      |
| `bench-ts-only`           | `.ts` harvested from sibling fuz-ecosystem repos' `src/` (see `init.sh`)      | `git reset --hard` on the harvested snapshot                       | 2 × 5         | all 5 (incl. tsv)        |

The two embedded/full-features scenarios deliberately drop plain-prettier and
biome and bench only the prettier+oxc-parser vs oxfmt pair. File-type scoping is
done per formatter: `prettierignore` (allowlist via `!*.ext`), oxfmt
`ignorePatterns`, and biome `files.includes`. `bench-ts-only` uses the same
three-way scoping narrowed to `.ts` (the common set every formatter, including
tsv, supports) so the comparison is apples-to-apples; `bench-large-single-file`
needs no scoping since its corpus is a single `.ts` file.

**Methodology caveat:** every scenario runs hyperfine with `--ignore-failure`
(and the memory pass swallows command errors), so a formatter that _errors_
partway is still timed rather than penalized — one that rejected much of the
corpus could look artificially fast. When adding a formatter — tsv is a native
Rust parser that may reject syntax the JS tools accept — confirm it processes the
corpus cleanly first: `tsv format --check <dir>` should report `… would change,
… unchanged` with **no** `error:` lines (tsv currently does, clean, on the `.ts`
corpus).

**Concurrency, when reading the numbers:** the harness never caps threads, so
each formatter runs at its own default — tsv, oxfmt, and biome parallelize across
files; prettier is effectively single-threaded. So on the multi-file scenarios
the wall-clock comparison bakes in each tool's own parallelism (a User-time far
above wall-time is the tell for the parallel ones), which is the intended
real-world measure. `bench-large-single-file` is the controlled exception — one
file means one thread for everyone, isolating raw single-file throughput.

## Running

```bash
pnpm install                  # or ./init.sh (also fetches corpora)
pnpm run bench                # all scenarios; auto-runs ./init.sh if data missing
pnpm run update-readme        # run + rewrite README results/versions sections
node ./bench-js-no-embedded/bench.mjs   # one scenario directly
```

External tools required: **hyperfine** (`apt install hyperfine`) and **GNU
time** (`apt install time` → `/usr/bin/time`; macOS `brew install gnu-time` →
`gtime`). Without GNU time the timing benchmarks still run; only memory is
skipped.

`update-readme` scrapes stdout from `vp run bench`, replaces the block between
`<!-- BENCHMARK_RESULTS_START -->` / `<!-- BENCHMARK_RESULTS_END -->` in
`README.md`, and refreshes the `## Versions` section. The prettier/biome/oxfmt
versions come from `vp exec <bin> --version`; tsv's comes from
`[workspace.package]` in `../tsv/Cargo.toml` (it's a native binary, no npm
version to query). CI (`.github/workflows`) runs `vp run bench` on push/PR; a
separate workflow opens an auto-merging PR to refresh the README when
`pnpm-lock.yaml` changes.

**Heads-up — tsv benchmarking is local-only, and the README `## Results` block
is currently pre-tsv.** The CI workflows aren't tsv-aware: they don't check out
`../tsv` or the sibling fuz-ecosystem repos the corpus is harvested from, so in
CI `init.sh` skips the tsv build and harvests an _empty_ `bench-ts-only/data`,
and the tsv scenarios error out (the run continues — per-scenario errors and
hyperfine `--ignore-failure` are non-fatal). So the auto-PR that refreshes the
README on `pnpm-lock.yaml` changes can never produce tsv numbers. The Versions
list was hand-updated to include tsv, but the Results block still shows only the
original four formatters with no `bench-ts-only` section. To regenerate it with
tsv, run `pnpm run update-readme` **locally** (where `../tsv` and the sibling
repos exist). Teaching CI to run tsv would mean checking the sibling repos —
some private — into CI, a separate decision.

## Adding a formatter or scenario

- **New scenario**: create `bench-<name>/` (copy an existing one), add the dir
  name to the `scenarios` array in `bench-all.mjs`, and add any corpus fetch to
  `init.sh`.
- **New formatter**: add a command builder to `createFormatters` in
  `shared/utils.mjs`, then add a `-n=<name>` arg + command to each scenario's
  `runHyperfine([...])` call and a matching entry in its `runMemoryBenchmarks`
  list. If it's a native binary rather than an npm `.bin` (as tsv is), resolve
  it via an env-var override with a sibling-checkout default, teach `init.sh` to
  build/locate it, and source its version from the binary/repo (not
  `vp exec … --version`) in `bench-all-and-update-readme.mjs`.

## The tsv integration

[`tsv`](https://github.com/fuzdev/tsv) (`~/dev/tsv`) is wired in as a fifth
formatter — the defining difference between this fork and upstream. Where it
lives:

- **Binary**: `tsv` from the `tsv_cli` crate — `cargo build -p tsv_cli
--release` → `target/release/tsv`. It's a native Rust binary, not an npm
  `.bin`, so `createFormatters` resolves it via `TSV_BIN` (default
  `<projectRoot>/../tsv/target/release/tsv`) rather than `node_modules/.bin`.
  `init.sh` builds it if missing and `../tsv` is present (full setup, including
  the copy-in path, under "Setting up the tsv binary" below).
- **In-place, non-configurable**: `tsv format <paths>` writes only when output
  differs and takes no config file or flags — it slots straight into the
  reset-then-format-then-measure loop.
- **Parallelism**: `tsv format` is multi-file parallel — a pool of worker threads
  (default = `std::thread::available_parallelism()`, i.e. the logical core count)
  pulling the next file from a shared atomic counter over the sorted file list
  (std threads, dynamic load-balancing, no rayon). The bench passes no `--jobs`,
  so tsv uses all cores — the same posture as oxfmt and biome. The worker count
  is clamped to the file count, so a single-file input runs on one thread: in
  `bench-large-single-file` tsv (like every tool) is effectively single-threaded,
  and only the multi-file scenarios exercise its parallelism.
- **No JSX/TSX**: tsv's parsers are `typescript | svelte | css` only, so it runs
  only where the corpus is `.ts` (or, in principle, `.svelte`/`.css`):
  `bench-large-single-file` (single `.ts` file, ideal as-is) and `bench-ts-only`
  (a `.ts` corpus harvested by `init.sh` from sibling fuz-ecosystem repos' `src/`
  and snapshotted as a git repo — for `git reset --hard` like the cloned
  scenarios, and, less obviously, to anchor tsv's discovery; see the git-repo
  bullet below). In those scenarios every _other_ formatter is scoped down to the
  `.ts` subset so the head-to-head is apples-to-apples. The three embedded/JSX
  scenarios are left tsv-free.
- **Directory discovery** (a `tsv format <dir>` arg, as the scenarios use): tsv
  recurses over `.ts`/`.svelte`/`.css` only and is gitignore-aware — inside a git
  repo it honors `.gitignore` (hierarchically) plus a repo-root `.formatignore` /
  `.prettierignore`, always pruning `.git`/`node_modules`; outside a repo it
  applies a build-output heuristic (`dist`/`build`/`target` + hidden dirs) and
  warns that a `.prettierignore` won't be read. Verified against `~/dev/tsv` and
  the harvested corpus: tsv's discovered set matches the on-disk `.ts` set
  exactly, which holds _because_ the harvest is `.ts`-only with no `.svelte`/
  `.css`/`.d.ts` and no in-corpus ignore files — keep it that way, or tsv would
  format files the `.ts`-scoped formatters skip and the comparison would stop
  being apples-to-apples. (Note: tsv _does_ format `.d.ts`, since the extension
  is `.ts`.) `tsv format <dir> --list` prints the in-scope set without writing —
  the read-only way to confirm scope.
- **Why the corpus must stay a git repo (subtle, load-bearing):** the outer
  bench-formatter repo's `.gitignore` ignores `bench-*/data/`. `bench-ts-only`
  only discovers anything because `init.sh` runs `git init` _inside_ `data/` —
  that makes `data/` tsv's format root, so the outer `.gitignore` sits above the
  root and is never read. Remove the `git init` and tsv's format root becomes the
  bench-formatter repo, which _does_ ignore `bench-*/data/`, so discovery returns
  **zero** files. `bench-large-single-file` sidesteps the same trap differently:
  it passes the file (`./data/parser.ts`) explicitly, and an explicit file arg
  bypasses the ignore files — a `tsv format ./data` _directory_ arg there would
  be pruned by the outer `.gitignore`. Both confirmed via `--list`.
- **Version**: sourced from `[workspace.package]` in `../tsv/Cargo.toml` by
  `bench-all-and-update-readme.mjs` (see Running, above).

### Setting up the tsv binary

The harness resolves tsv from `TSV_BIN`, falling back to
`../tsv/target/release/tsv`. Two ways to get a usable binary in place:

- **Sibling checkout (default — `init.sh` automates it):** keep the tsv repo at
  `~/dev/tsv`. `init.sh` (run directly, or by `pnpm run bench` when data is
  missing) builds it when the resolved path isn't executable:

  ```bash
  cargo build --release -p tsv_cli --manifest-path ../tsv/Cargo.toml
  ```

  No copying — the default `TSV_BIN` points straight at the sibling's `target/`.

- **Copy a prebuilt binary in (when `../tsv` isn't a sibling, or to pin a fixed
  build):** build it once in the tsv repo, copy the binary somewhere stable, and
  point the harness at it via `TSV_BIN`:

  ```bash
  # in the tsv repo
  cargo build --release -p tsv_cli          # → target/release/tsv
  cp target/release/tsv /some/stable/path/tsv

  # then run the bench against the copy
  TSV_BIN=/some/stable/path/tsv pnpm run bench
  ```

  `init.sh` treats an executable `$TSV_BIN` as already-present — it won't rebuild
  or overwrite it — so the copy is used as-is. It's an ordinary dynamically-linked
  Rust binary: fine to move within the same OS/arch, not a portable static build.
  Caveat for `update-readme`: the README's tsv **version** is read from
  `../tsv/Cargo.toml`, not from the binary, so on the copy-in path without a
  sibling `../tsv` it falls back to `unknown` — keep `../tsv` around (or fix the
  version by hand) when regenerating the README.

### Future tsv work (planned, not yet done)

The current coverage is `.ts`-only. tsv also formats `.svelte` and `.css`, and
those parsers are **not yet exercised** by any scenario. Candidates:

- A Svelte/CSS corpus (or extending `bench-ts-only`'s harvest beyond `*.ts`) so
  tsv's other two parsers get benchmarked.
- tsv-scoped `.ts`/`.css`/`.svelte` variants of the embedded scenarios
  (`bench-mixed-embedded`, `bench-full-features`) — i.e. narrowing those corpora
  to tsv's supported set rather than leaving tsv out of them entirely.

When adding these, keep the apples-to-apples discipline: scope _every_ formatter
in a tsv-inclusive run to the same file set (the three-way `prettierignore` /
oxfmt `ignorePatterns` / biome `files.includes` scoping), and regenerate the
README Results afterward.
