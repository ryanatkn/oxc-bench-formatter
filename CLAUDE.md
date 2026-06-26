# CLAUDE.md

Navigation aid for this repo. The upstream agent guidance lives in
[AGENTS.md](AGENTS.md) (this file used to be a symlink to it); this file is the
fuller working map, including the planned tsv integration.

## What this is

A benchmark suite comparing JS/TS formatters on **execution time** (via
[hyperfine](https://github.com/sharkdp/hyperfine)) and **peak memory / RSS**
(via GNU `time`). Formatters compared today:

- **prettier** (`prettier --write`)
- **prettier+oxc-parser** (prettier with `@prettier/plugin-oxc`)
- **biome** (`biome format --write`)
- **oxfmt** (`oxfmt`)

All sources are ESM `.mjs`. No test framework or hand-rolled linter — quality
gating is delegated to **vite-plus** (`vp`): `prepare` runs `vp config`, staged
files run `vp check --fix` (see `vite.config.ts`), and `.vite-hooks/pre-commit`
runs `vp staged`. Package manager is pnpm 11.4.0; Node is `lts/*`.

## Layout

```
bench-formatter/
├── bench-all.mjs                    # run every scenario in sequence (`pnpm run bench`)
├── bench-all-and-update-readme.mjs  # run + scrape output into README (`pnpm run update-readme`)
├── init.sh                          # install deps, clone data repos, download parser.ts
├── shared/utils.mjs                 # the harness: formatter commands + hyperfine + memory
├── bench-large-single-file/         # one scenario per dir (structure below)
├── bench-js-no-embedded/
├── bench-mixed-embedded/
├── bench-full-features/
├── vite.config.ts / pnpm-workspace.yaml  # vite-plus tooling + catalog
└── .github/workflows/               # ci.yml, security, update-readme
```

Each `bench-*/` scenario dir has an identical shape:

```
bench-<name>/
├── bench.mjs        # scenario entry: setupCwd → hyperfine runs → memory runs
├── biome.json       # biome config (sometimes empty when biome isn't run)
├── oxfmtrc.json     # oxfmt config
├── prettierrc.json  # prettier config (+ prettierrc-oxc.json where the oxc plugin variant is benched)
├── prettierignore   # prettier ignore (also used to scope which files are formatted)
└── data/            # test corpus — gitignored, fetched by init.sh
```

## The harness — `shared/utils.mjs`

- **`createFormatters(projectRoot, configDir)`** → `{ prettier, biome, oxfmt }`
  command builders. Binaries resolve at `<projectRoot>/node_modules/.bin/`;
  configs read from `configDir`. Each builder takes the file/dir args:
  - `prettier(files, cfg = "prettierrc.json")` → `… --write --config <dir>/<cfg> --ignore-path <dir>/prettierignore --ignore-unknown`
  - `biome(files)` → `biome format --write --files-ignore-unknown=true --config-path <dir> <files>`
  - `oxfmt(files)` → `oxfmt --config <dir>/oxfmtrc.json <files>`
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

| Dir | Corpus | Reset / prepare | warmup × runs | Formatters run |
|-----|--------|-----------------|---------------|----------------|
| `bench-large-single-file` | TS compiler `parser.ts` (~540KB, v5.9.2) | `cp parser.ts.bak parser.ts` | 2 × 5 | all 4 |
| `bench-js-no-embedded` | [outline](https://github.com/outline/outline) (js/ts/jsx/tsx) | `git reset --hard` | 3 × 10 | all 4 |
| `bench-mixed-embedded` | [storybook](https://github.com/storybookjs/storybook) (embedded langs) | `git reset --hard` + rm stray prettier configs | 1 × 3 | prettier+oxc, oxfmt |
| `bench-full-features` | [continue](https://github.com/continuedev/continue) (sort-imports + tailwind) | `git reset --hard` + strip a tailwind `require` + rm `.prettierrc` | 1 × 3 | prettier+oxc, oxfmt |

The two embedded/full-features scenarios deliberately drop plain-prettier and
biome and bench only the prettier+oxc-parser vs oxfmt pair. File-type scoping is
done per formatter: `prettierignore` (allowlist via `!*.ext`), oxfmt
`ignorePatterns`, and biome `files.includes`.

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
`README.md`, and refreshes the `## Versions` section. CI (`.github/workflows`)
runs `vp run bench` on push/PR; a separate workflow opens an auto-merging PR to
refresh the README when `pnpm-lock.yaml` changes.

## Adding a formatter or scenario

- **New scenario**: create `bench-<name>/` (copy an existing one), add the dir
  name to the `scenarios` array in `bench-all.mjs`, and add any corpus fetch to
  `init.sh`.
- **New formatter**: add a command builder to `createFormatters` in
  `shared/utils.mjs`, then add a `-n=<name>` arg + command to each scenario's
  `runHyperfine([...])` call and a matching entry in its `runMemoryBenchmarks`
  list.

## Planned: adding tsv (not yet wired — see TODO)

We're adding [`tsv`](https://github.com/fuzdev/tsv) (`~/dev/tsv`) as a fifth
formatter. Key facts that shape the wiring:

- **Binary**: `tsv` from the `tsv_cli` crate — `cargo build -p tsv_cli --release`
  → `target/release/tsv`, or `cargo run -p tsv_cli -- format <paths>`. It's a
  native Rust binary, not an npm `.bin`, so its command builder won't follow the
  `node_modules/.bin` pattern.
- **In-place formatting**: `tsv format <paths>` writes only when output differs
  — fits the existing reset-then-format-then-measure loop directly.
- **No JSX/TSX**: tsv's parsers are `typescript | svelte | css` only. `.jsx` /
  `.tsx` must be **omitted** from any tsv-inclusive comparison. Directory
  discovery already recurses only `.ts` / `.svelte` / `.css` (gitignore-aware:
  `.gitignore` / `.formatignore` / `.prettierignore`), so the natural
  apples-to-apples set is the `.ts` subset — `bench-large-single-file`
  (`parser.ts`) is ideal as-is; the repo corpora need their other formatters
  scoped to `.ts` (drop `.js`/`.jsx`/`.tsx`) for a fair head-to-head.
- **Open design point for the wiring step**: whether to add a tsv-only scenario
  variant scoped to `.ts`/`.css`/`.svelte`, or to narrow the existing scenarios'
  include sets when tsv is in the run. Decide before editing the configs.
