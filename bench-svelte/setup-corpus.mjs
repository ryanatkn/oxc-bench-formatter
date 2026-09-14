#!/usr/bin/env node

// Builds the bench-svelte corpus: a .svelte-only snapshot of seven third-party
// sources, committed into ./data as its own git repo.
//
// The sources are collections of the fuzdev/corpora snapshot — a sibling
// ../../corpora checkout — read at ONE pinned corpora commit (CORPORA_COMMIT)
// through `git archive`, never from the working tree. So this bench's corpus
// and tsv's own benchmark corpus are the same bytes under one SHA, a rebuild
// reproduces them whatever the checkout currently has checked out, and moving
// the corpus is a one-line, reviewable pin bump. The snapshot already leaves
// each upstream's test fixtures behind, so the only filter left here is the
// extension.
//
// Why a snapshot instead of formatting the checkout in place: the two
// formatters discover files differently (tsv is config-free and
// gitignore-aware; rsvelte-fmt walks .svelte in-process and hands everything
// else to oxfmt, which would pick up .json/.md/etc), so a tree containing ONLY
// the corpus files is the one way to guarantee both tools format the same set.
// The `git init` is load-bearing twice over: it makes data/ its own git root so
// the outer repo's .gitignore (which ignores bench-*/data/) is never read by
// tsv's discovery, and it gives the bench its reset-per-run baseline.
//
// Sources (all third-party and prettier-shaped, so neither benched formatter is
// measured on code it already shaped): kit, svelte.dev, layerchart, svelte-ux,
// flowbite-svelte, svelte-maplibre, layercake — each vendored by corpora at the
// upstream commit its manifest names, which the corpus commit's provenance
// records. (svelte is deliberately absent: its packages/svelte/src is the
// compiler, which contains no .svelte files.)
//
// Idempotent: exits early if ./data exists. Delete ./data to regenerate.

import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

process.chdir(dirname(fileURLToPath(import.meta.url)));

const dataDir = "./data";

// The corpora checkout and the commit the corpus is read at. Bumping the commit
// is how the corpus moves; `git -C ../corpora fetch` (from the bench-formatter
// root) first if the checkout doesn't have it yet. Resolved to an absolute path
// so the messages below read the same from any cwd.
const corporaDir = resolve("../../corpora");
const CORPORA_COMMIT = "1117b4829309e4c3647eb2e8c3cdd34a993eb217";
const COLLECTIONS = [
  "kit",
  "svelte.dev",
  "layerchart",
  "svelte-ux",
  "flowbite-svelte",
  "svelte-maplibre",
  "layercake",
];

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options });
}

// Every path handed to corpora's git is a literal one from its own tree listing,
// never a pattern — and SvelteKit route names like `[slug]` and `[...rest]` are
// pathspec wildcards, so say so rather than lean on git trying a literal match
// before the glob.
function corporaGit(args, options = {}) {
  return git(["-C", corporaDir, ...args], {
    ...options,
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
}

function main() {
  if (existsSync(dataDir)) {
    console.log("bench-svelte corpus already exists (delete ./data to regenerate)");
    return;
  }

  if (!existsSync(join(corporaDir, ".git"))) {
    console.error(
      `Missing sibling checkout ${corporaDir} — clone https://github.com/fuzdev/corpora next to the bench-formatter repo`,
    );
    process.exit(1);
  }
  try {
    corporaGit(["cat-file", "-e", `${CORPORA_COMMIT}^{commit}`], { stdio: "ignore" });
  } catch {
    console.error(
      `${corporaDir} does not have commit ${CORPORA_COMMIT} — run \`git -C ${corporaDir} fetch\``,
    );
    process.exit(1);
  }

  // The manifest at the pinned commit names each collection's upstream commit —
  // the provenance the corpus commit records.
  const manifest = JSON.parse(corporaGit(["show", `${CORPORA_COMMIT}:manifest.json`]));
  const byName = new Map(manifest.collections.map((c) => [c.name, c]));

  console.log(`Copying .svelte files from ${corporaDir} at ${CORPORA_COMMIT.slice(0, 12)}...`);
  const provenance = [];
  let total = 0;
  for (const name of COLLECTIONS) {
    const collection = byName.get(name);
    if (!collection) {
      console.error(`corpora@${CORPORA_COMMIT.slice(0, 12)} has no collection named ${name}`);
      process.exit(1);
    }
    const prefix = `collections/${name}/`;
    const paths = corporaGit(["ls-tree", "-r", "--name-only", "-z", CORPORA_COMMIT, "--", prefix])
      .split("\0")
      .filter((p) => p.endsWith(".svelte"))
      .sort();
    if (paths.length === 0) {
      console.error(`Collection ${name} contributed no .svelte files — did its layout change?`);
      process.exit(1);
    }
    // One archive per collection, extracted under data/<name>/ with the
    // `collections/<name>/` prefix stripped, so the upstream-relative layout
    // (data/<name>/<subpath>/<relative>) is kept.
    const dest = join(dataDir, name);
    mkdirSync(dest, { recursive: true });
    const tar = corporaGit(["archive", "--format=tar", CORPORA_COMMIT, "--", ...paths], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "--strip-components=2", "-C", dest], { input: tar });
    provenance.push(
      `${name}@${collection.commit.slice(0, 12)} ${collection.subpaths.join("+")} (${paths.length} files)`,
    );
    console.log(`  ${provenance[provenance.length - 1]}`);
    total += paths.length;
  }

  git(["init", "-q", dataDir]);
  git(["-C", dataDir, "add", "-A"]);
  git([
    "-C",
    dataDir,
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@localhost",
    "commit",
    "-q",
    "-m",
    `svelte corpus: ${total} .svelte files\n\nfuzdev/corpora@${CORPORA_COMMIT}\n${provenance.join("\n")}`,
  ]);
  console.log(`Svelte corpus ready: ${total} .svelte files in ${dataDir}`);
}

main();
