#!/usr/bin/env node

// Builds the bench-svelte corpus: a .svelte-only snapshot of seven third-party
// sources, committed into ./data as its own git repo.
//
// Why a snapshot instead of formatting the checkouts in place: the two
// formatters discover files differently (tsv is config-free and
// gitignore-aware; rsvelte-fmt walks .svelte in-process and hands everything
// else to oxfmt, which would pick up .json/.md/etc), so a tree containing ONLY
// the corpus files is the one way to guarantee both tools format the same set.
// The `git init` is load-bearing twice over: it makes data/ its own git root so
// the outer repo's .gitignore (which ignores bench-*/data/) is never read by
// tsv's discovery, and it gives the bench its reset-per-run baseline.
//
// Sources (all third-party and prettier-shaped, so neither benched formatter is
// measured on code it already shaped):
// - sibling checkouts ../kit and ../svelte.dev — the same trees tsv's own
//   benchmark corpus uses (../svelte is deliberately absent: its
//   packages/svelte/src is the compiler, which contains no .svelte files)
// - shallow clones of five Svelte component libraries into ./repos/
//   (gitignored, kept as a cache across rebuilds)
//
// Idempotent: exits early if ./data exists. Delete ./data to regenerate.

import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

process.chdir(dirname(fileURLToPath(import.meta.url)));

const dataDir = "./data";
const reposDir = "./repos";

const SOURCES = [
  {
    name: "kit",
    root: "../../kit",
    subpaths: ["packages/kit/src"],
    missingHint: "clone https://github.com/sveltejs/kit next to the bench-formatter repo",
  },
  {
    name: "svelte.dev",
    root: "../../svelte.dev",
    subpaths: ["apps/svelte.dev/src", "packages/repl/src", "packages/site-kit/src"],
    missingHint: "clone https://github.com/sveltejs/svelte.dev next to the bench-formatter repo",
  },
  {
    name: "layerchart",
    clone: "https://github.com/techniq/layerchart.git",
    subpaths: ["packages/layerchart/src"],
  },
  {
    name: "svelte-ux",
    clone: "https://github.com/techniq/svelte-ux.git",
    subpaths: ["packages/svelte-ux/src"],
  },
  {
    name: "flowbite-svelte",
    clone: "https://github.com/themesberg/flowbite-svelte.git",
    subpaths: ["src"],
  },
  {
    name: "svelte-maplibre",
    clone: "https://github.com/dimfeld/svelte-maplibre.git",
    subpaths: ["src"],
  },
  {
    name: "layercake",
    clone: "https://github.com/mhkeller/layercake.git",
    subpaths: ["src"],
  },
];

// Fixture pruning mirrors tsv's perf-view corpus rules: exclude `fixtures`
// segments anywhere and `samples` segments preceded by a `test` segment
// (kit's test/samples), plus non-source dirs and hidden dirs.
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".svelte-kit", ".gro", "fixtures"]);

function isExcluded(relative) {
  const segments = relative.split("/");
  if (segments.some((s) => EXCLUDED_SEGMENTS.has(s) || s.startsWith("."))) {
    return true;
  }
  const samplesIndex = segments.indexOf("samples");
  return samplesIndex !== -1 && segments.slice(0, samplesIndex).includes("test");
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options });
}

function main() {
  if (existsSync(dataDir)) {
    console.log("bench-svelte corpus already exists (delete ./data to regenerate)");
    return;
  }

  for (const source of SOURCES) {
    if (source.clone) {
      source.root = join(reposDir, source.name);
      if (!existsSync(source.root)) {
        console.log(`Cloning ${source.clone}...`);
        mkdirSync(reposDir, { recursive: true });
        git(["clone", "--depth=1", source.clone, source.root], { stdio: "inherit" });
      }
    } else if (!existsSync(source.root)) {
      console.error(`Missing sibling checkout ${source.root} — ${source.missingHint}`);
      process.exit(1);
    }
  }

  console.log("Copying .svelte files (fixtures pruned)...");
  const provenance = [];
  let total = 0;
  for (const source of SOURCES) {
    let count = 0;
    for (const subpath of source.subpaths) {
      const base = join(source.root, subpath);
      for (const relative of readdirSync(base, { recursive: true }).sort()) {
        if (!relative.endsWith(".svelte") || isExcluded(relative)) {
          continue;
        }
        const dest = join(dataDir, source.name, subpath, relative);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(join(base, relative), dest);
        count++;
      }
    }
    if (count === 0) {
      console.error(`Source ${source.name} contributed no files — did its layout change?`);
      process.exit(1);
    }
    const commit = git(["-C", source.root, "rev-parse", "--short=12", "HEAD"]).trim();
    provenance.push(`${source.name}@${commit} ${source.subpaths.join("+")} (${count} files)`);
    console.log(`  ${provenance[provenance.length - 1]}`);
    total += count;
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
    `svelte corpus: ${total} .svelte files\n\n${provenance.join("\n")}`,
  ]);
  console.log(`Svelte corpus ready: ${total} .svelte files in ${dataDir}`);
}

main();
