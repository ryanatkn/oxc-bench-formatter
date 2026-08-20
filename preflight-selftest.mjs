#!/usr/bin/env node

// Verifies that preflight can still read each formatter's diagnostics.
//
// `runPreflight` finds rejected files by matching tool-specific diagnostic text
// (`PREFLIGHT_MATCHERS` in shared/utils.mjs). Those matchers are the guard's
// weak point: when a formatter changes its error format, the matcher stops
// hitting and preflight reports "clean" forever — the guard silently becomes a
// no-op, and the very corpus it was meant to catch sails through into published
// numbers. Nothing about the benchmark run would look wrong.
//
// So each formatter is checked against two fixtures:
//
// - a file it MUST reject (a parse error), asserting its matcher fires and names
//   that file — catches a diagnostic format that drifted
// - a valid but unformatted file it MUST accept, whose text contains `key: value`
//   pairs, asserting nothing is reported — catches a matcher loose enough to read
//   echoed source lines or "would reformat" notices as rejected paths, and
//   confirms "would change" is never mistaken for "rejected"
// - for the formatters `PREFLIGHT_ERROR_SIGNALS` covers, a path that doesn't
//   exist, asserting the harness doesn't call a tool that failed at the command
//   level "clean" — the state in which it would be timed doing no work at all
//
// The scope counts (`PREFLIGHT_SCOPE_COUNTS`) ride along: one fixture file means
// every count must read exactly 1, so a count pattern that drifted can't quietly
// skew the cross-formatter comparison preflight makes from them.
//
// The fixtures and their configs are generated into a temp directory, so nothing
// broken is ever committed and this repo's own `vp check` never sees them. On
// failure the directory is left in place and its path printed.
//
// Run directly (`node ./preflight-selftest.mjs`, or `pnpm run preflight-selftest`);
// `bench-all.mjs` also runs it before any scenario, so a dead matcher stops the
// suite before it produces numbers.

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { assertScopeConfigsAgree, createFormatters, runPreflight } from "./shared/utils.mjs";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// prettier resolves a config's `plugins` entries relative to the config file,
// and these configs live in a temp directory with no node_modules above them —
// so resolve the plugin's entry file from this repo instead. It must be the
// file, not its directory: prettier imports plugins as ES modules, and a
// directory import isn't valid there. Null when the plugin isn't installed,
// which skips that formatter rather than failing it.
const resolveFromRoot = createRequire(join(projectRoot, "package.json"));
const oxcPlugin = (() => {
  try {
    return resolveFromRoot.resolve("@prettier/plugin-oxc");
  } catch {
    return null;
  }
})();

// A hard syntax error, not merely unparseable-by-some: every formatter here must
// reject it. Note what does NOT work as a universal fixture — JSX in a `.ts` file
// (`const x = <div>hi</div>`) is a parse error for prettier's default parser,
// biome, oxfmt, and tsv, but `@prettier/plugin-oxc` parses it and reports the
// file as already formatted.
const BROKEN_TS = "export const broken = ;\n";

// Valid TS, deliberately unformatted, carrying the `: ` pairs that a loose
// matcher misreads as `path: message` when a tool echoes source lines.
const CLEAN_TS = `const o = {alpha: 1, beta: 2}
   type Pair = {left: string, right: string}
export const pick = (p: Pair): string => p.left + o.alpha
`;

const BROKEN_SVELTE = "<script>let a = <div/></script>\n";

const CLEAN_SVELTE = `<script>
     const o = {alpha: 1, beta: 2}
</script>
<div style="color: red">{o.alpha}</div>
`;

// Minimal configs, one per tool, mirroring the scenarios' shapes. Written next
// to the fixtures so `configDir` is "." once we chdir in, exactly as a scenario
// resolves its own directory.
const CONFIGS = {
  "prettierrc.json": JSON.stringify({ useTabs: true, embeddedLanguageFormatting: "off" }),
  "prettierrc-oxc.json": JSON.stringify({
    useTabs: true,
    embeddedLanguageFormatting: "off",
    plugins: oxcPlugin ? [oxcPlugin] : [],
  }),
  // Nothing ignored — the fixtures are passed as explicit file arguments, and
  // prettier's `--ignore-path` still needs the file to exist.
  prettierignore: "# self-test fixtures: nothing ignored\n",
  "oxfmtrc.json": JSON.stringify({ printWidth: 80, useTabs: true }),
  "biome.json": JSON.stringify({
    vcs: { useIgnoreFile: false },
    formatter: { formatWithErrors: true },
    linter: { enabled: false },
  }),
};

const FIXTURES = {
  "broken.ts": BROKEN_TS,
  "clean.ts": CLEAN_TS,
  // A second valid file, so two formatters can be pointed at different-sized sets
  // to check the scope-parity rule itself.
  "clean2.ts": CLEAN_TS,
  "broken.svelte": BROKEN_SVELTE,
  "clean.svelte": CLEAN_SVELTE,
};

/**
 * One formatter's self-test: the check command to run, and the fixture it must
 * reject paired with the one it must accept. `name` must match the formatter's
 * key in `PREFLIGHT_MATCHERS` — that pairing is what's under test.
 */
function buildCases(formatters) {
  const jsFamily = [
    // `detectsCommandErrors` mirrors `PREFLIGHT_ERROR_SIGNALS` in
    // shared/utils.mjs: biome and oxfmt have no error prefix that can't also
    // appear on an ordinary check run, so they are knowingly unguarded there and
    // this case would fail for them.
    { name: "prettier", command: (f) => formatters.check.prettier(f), detectsCommandErrors: true },
    {
      name: "prettier+oxc-parser",
      command: (f) => formatters.check.prettier(f, "prettierrc-oxc.json"),
      detectsCommandErrors: true,
    },
    { name: "biome", command: (f) => formatters.check.biome(f), reportsConsidered: true },
    { name: "oxfmt", command: (f) => formatters.check.oxfmt(f), reportsConsidered: true },
    {
      name: "tsv",
      command: (f) => formatters.check.tsv(f),
      detectsCommandErrors: true,
      reportsConsidered: true,
    },
    // The WASM CLI is the same source as the native binary's and shares its
    // entries in all three preflight tables. Exercised anyway rather than
    // assumed: the two are separately built and separately published, so
    // "identical output" is a claim this checks, not a premise. It also proves
    // the shared entries are reachable under this second key — a row whose name
    // is missing from a table aborts its scenario.
    {
      name: "tsv-wasm",
      command: (f) => formatters.check["tsv-wasm"](f),
      detectsCommandErrors: true,
      reportsConsidered: true,
    },
  ];

  return [
    ...jsFamily.map((c) => ({ ...c, rejects: "broken.ts", accepts: "clean.ts" })),
    {
      name: "rsvelte-fmt",
      command: (f) => formatters.check.rsvelte(f),
      rejects: "broken.svelte",
      accepts: "clean.svelte",
      reportsConsidered: true,
    },
  ];
}

/** Run one check through the real `runPreflight` and report what it found. */
async function probe(name, command) {
  try {
    const report = await runPreflight([{ name, command }], { quiet: true });
    return { rejected: report.failures[name], counts: report.counts[name], clean: true };
  } catch (error) {
    const report = error.report;
    if (!report) throw error; // not a preflight failure — a bug in the harness
    return {
      rejected: report.failures[name] ?? [],
      unavailable: report.unavailable.includes(name),
      crashed: report.crashed.includes(name),
      unmatched: report.unmatched.includes(name),
      errored: report.errored.includes(name),
      counts: report.counts[name],
      clean: false,
    };
  }
}

async function main() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "bench-formatter-preflight-"));
  for (const [file, contents] of Object.entries({ ...CONFIGS, ...FIXTURES })) {
    writeFileSync(join(fixtureDir, file), contents);
  }

  // Scenarios chdir into their own directory and pass relative paths; do the
  // same so config and ignore-path resolution matches a real run.
  process.chdir(fixtureDir);
  const formatters = createFormatters(projectRoot, ".");

  console.log("=========================================");
  console.log("Preflight matcher self-test");
  console.log("=========================================");
  console.log("");
  console.log("Each formatter must reject a broken fixture and accept a valid unformatted one.");
  console.log("");

  const failures = [];
  const skipped = [];

  const cases = buildCases(formatters).filter((c) => {
    if (c.name === "prettier+oxc-parser" && !oxcPlugin) {
      skipped.push(c.name);
      console.log(`  ${c.name}: @prettier/plugin-oxc not installed — matcher unverified`);
      return false;
    }
    return true;
  });

  for (const testCase of cases) {
    const { name, command, rejects, accepts, detectsCommandErrors, reportsConsidered } = testCase;

    const onBroken = await probe(name, command(`./${rejects}`));
    if (onBroken.unavailable) {
      // Not a failure: the binary is absent (tsv on a CI runner that never built
      // it), so this matcher is simply unverified. Unlike preflight, an
      // unverifiable matcher here produces no misleading benchmark row.
      skipped.push(name);
      console.log(`  ${name}: unavailable — matcher unverified`);
      continue;
    }

    const problems = [];
    if (onBroken.crashed) {
      problems.push(`crashed on ${rejects}`);
    } else if (onBroken.unmatched) {
      problems.push("no entry in PREFLIGHT_MATCHERS");
    } else if (!onBroken.rejected.includes(rejects)) {
      problems.push(
        `did not report ${rejects} as rejected (matcher missed its diagnostics; saw ${
          onBroken.rejected.length === 0 ? "nothing" : onBroken.rejected.join(", ")
        })`,
      );
    }

    const onClean = await probe(name, command(`./${accepts}`));
    if (onClean.rejected.length > 0) {
      problems.push(`reported ${onClean.rejected.join(", ")} on the valid fixture ${accepts}`);
    } else if (!onClean.clean) {
      problems.push(`did not accept the valid fixture ${accepts}`);
    }

    // The scope counts preflight compares across formatters come from the same
    // per-tool text, so they drift the same way. One fixture file means every
    // count must read exactly 1 — a matcher that silently returns null (or the
    // wrong number) fails here rather than skewing a parity check later.
    if (onClean.counts?.changed !== 1) {
      problems.push(`read ${onClean.counts?.changed ?? "no"} would-change count, expected 1`);
    }
    if (reportsConsidered && onClean.counts?.considered !== 1) {
      problems.push(`read ${onClean.counts?.considered ?? "no"} file count, expected 1`);
    }

    if (detectsCommandErrors) {
      const onMissing = await probe(name, command("./does-not-exist.ts"));
      if (onMissing.clean) {
        problems.push(
          "reported clean for a path that doesn't exist — a command-level failure would be timed as work",
        );
      }
    }

    if (problems.length > 0) {
      failures.push({ name, problems });
      console.log(`  ${name}: FAILED`);
      for (const problem of problems) console.log(`      ${problem}`);
    } else {
      const covers = detectsCommandErrors ? ", catches command-level errors" : "";
      console.log(`  ${name}: ok (rejects ${rejects}, clean on ${accepts}${covers})`);
    }
  }

  // The static scope check has its own failure modes: a trio that disagrees must
  // throw, and so must a pattern it can't parse — an allowlist it silently skips
  // is an allowlist it isn't checking.
  const scopeCases = [
    {
      label: "mismatched extensions",
      files: {
        prettierignore: "*\n!*/\n!*.ts\n!*.js\n",
        "oxfmtrc.json": JSON.stringify({ ignorePatterns: ["*", "!*/", "!*.ts"] }),
        "biome.json": JSON.stringify({ files: { includes: ["**/*.ts", "**/*.js"] } }),
      },
      expect: /scope configs disagree/,
    },
    {
      label: "unparseable pattern",
      files: {
        prettierignore: "*\n!*/\n!*.ts\n!src/**/*.ts\n",
        "oxfmtrc.json": JSON.stringify({ ignorePatterns: ["*", "!*/", "!*.ts"] }),
        "biome.json": JSON.stringify({ files: { includes: ["**/*.ts"] } }),
      },
      expect: /can't read/,
    },
  ];

  for (const { label, files, expect } of scopeCases) {
    const dir = mkdtempSync(join(tmpdir(), "bench-formatter-scope-"));
    for (const [file, contents] of Object.entries(files)) writeFileSync(join(dir, file), contents);
    try {
      assertScopeConfigsAgree(dir);
      failures.push({ name: `scope configs (${label})`, problems: ["did not throw"] });
      console.log(`  scope configs (${label}): FAILED — did not throw`);
    } catch (error) {
      if (expect.test(error.message)) {
        console.log(`  scope configs (${label}): ok (rejected)`);
      } else {
        failures.push({
          name: `scope configs (${label})`,
          problems: [`threw the wrong error: ${error.message}`],
        });
        console.log(`  scope configs (${label}): FAILED — threw the wrong error`);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // The count matchers are verified above; this checks what preflight does with
  // them. Two formatters pointed at different file sets must abort — the rule that
  // makes a drifted `prettierignore` or a corpus that grew a new file type loud
  // instead of silent.
  if (!skipped.includes("tsv")) {
    try {
      await runPreflight(
        [
          { name: "tsv", command: formatters.check.tsv("./clean.ts") },
          { name: "biome", command: formatters.check.biome("./clean.ts ./clean2.ts") },
        ],
        { quiet: true },
      );
      failures.push({ name: "scope parity", problems: ["mismatched file counts did not abort"] });
      console.log("  scope parity: FAILED — mismatched file counts did not abort");
    } catch (error) {
      if (/scope mismatch/.test(error.message)) {
        console.log("  scope parity: ok (mismatched file counts abort)");
      } else {
        failures.push({
          name: "scope parity",
          problems: [`aborted for the wrong reason: ${error.message}`],
        });
        console.log(`  scope parity: FAILED — aborted for the wrong reason: ${error.message}`);
      }
    }
  }

  console.log("");
  if (failures.length > 0) {
    console.log(
      `Preflight matcher self-test FAILED: ${failures.length} check(s) — preflight would pass corpora it should stop.`,
    );
    console.log(`Fixtures kept for debugging: ${fixtureDir}`);
    process.exit(1);
  }

  const verified = buildCases(formatters).length - skipped.length;
  console.log(
    `Preflight matcher self-test passed: ${verified} matcher(s) verified${
      skipped.length > 0 ? `, ${skipped.length} unverified (${skipped.join(", ")})` : ""
    }.`,
  );
  process.chdir(projectRoot);
  rmSync(fixtureDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error("Preflight matcher self-test failed:", error.message);
  process.exit(1);
});
