#!/bin/bash

# Install pnpm dependencies
echo "Installing pnpm dependencies..."
pnpm install

# Clone Outline repository if not exists
if [ ! -d "bench-js-no-embedded/data" ]; then
	echo "Cloning Outline repository..."
	git clone --depth=1 https://github.com/outline/outline.git bench-js-no-embedded/data
else
	echo "Outline repository already exists"
fi

# Clone Storybook repository for mixed-embedded benchmark if not exists
if [ ! -d "bench-mixed-embedded/data" ]; then
	echo "Cloning Storybook repository for mixed-embedded benchmark..."
	git clone --depth=1 https://github.com/storybookjs/storybook.git bench-mixed-embedded/data
else
	echo "Storybook repository for mixed-embedded already exists"
fi

# Clone Continue repository for full-features benchmark if not exists
if [ ! -d "bench-full-features/data" ]; then
	echo "Cloning Continue repository for full-features benchmark..."
	git clone --depth=1 https://github.com/continuedev/continue.git bench-full-features/data
else
	echo "Continue repository for full-features already exists"
fi

# Download TypeScript compiler parser.ts if not exists
if [ ! -f "bench-large-single-file/data/parser.ts" ]; then
	echo "Downloading TypeScript compiler parser.ts..."
	mkdir -p bench-large-single-file/data
	curl -o bench-large-single-file/data/parser.ts https://raw.githubusercontent.com/microsoft/TypeScript/refs/tags/v5.9.2/src/compiler/parser.ts
	cp bench-large-single-file/data/parser.ts bench-large-single-file/data/parser.ts.bak
	echo "Downloaded parser.ts (TypeScript v5.9.2)"
else
	echo "parser.ts already exists"
fi

# Check hyperfine installation
if ! command -v hyperfine &> /dev/null; then
	echo ""
	echo "Hyperfine is not installed!"
	echo "Please install hyperfine: https://github.com/sharkdp/hyperfine"
	echo "On macOS: brew install hyperfine"
	echo "On Ubuntu/Debian: apt install hyperfine"
else
	echo "Hyperfine is installed"
fi

# Check GNU time installation
if command -v gtime &> /dev/null; then
	echo "GNU time is installed (gtime)"
elif /usr/bin/time --version &> /dev/null; then
	echo "GNU time is installed (/usr/bin/time)"
else
	echo ""
	echo "GNU time is not installed!"
	echo "Memory benchmarking requires GNU time (not BSD time)"
	echo "On macOS: brew install gnu-time (installs as gtime)"
	echo "On Ubuntu/Debian: apt install time"
fi

# Harvest a .ts-only corpus for the tsv-fair benchmark (bench-ts-only).
# tsv only formats .ts/.svelte/.css (no JSX/TSX), so this scenario compares every
# formatter on the common .ts subset. Sources mirror the first-party fuz-ecosystem
# subset of tsv's own benchmark corpus (sibling repos under ../). The files are
# copied (never formatted in place in the real repos) and snapshotted as a git
# repo so the bench can `git reset --hard` between runs like the cloned scenarios.
TS_CORPUS_REPOS=(zzz fuz_app fuz_css fuz_ui fuz_util fuz_template fuz_blog fuz_mastodon fuz_code fuz_docs fuz_gitops gro svelte-docinfo tsv.fuz.dev)
TS_DATA_DIR="bench-ts-only/data"
if [ ! -d "$TS_DATA_DIR" ]; then
	echo ""
	echo "Harvesting .ts corpus into $TS_DATA_DIR ..."
	root="$(pwd)"
	for repo in "${TS_CORPUS_REPOS[@]}"; do
		src="../$repo/src"
		if [ ! -d "$src" ]; then
			echo "  skip $repo (no $src)"
			continue
		fi
		dest="$root/$TS_DATA_DIR/$repo"
		mkdir -p "$dest"
		( cd "$src" && find . -type f -name '*.ts' ! -name '*.d.ts' -print0 \
			| xargs -0 --no-run-if-empty cp --parents -t "$dest" )
		echo "  $repo: $(find "$dest" -type f -name '*.ts' | wc -l) files"
	done
	git -C "$TS_DATA_DIR" init -q
	git -C "$TS_DATA_DIR" add -A
	git -C "$TS_DATA_DIR" -c user.email=bench@local -c user.name=bench commit -q -m "ts corpus snapshot"
	echo "  total: $(find "$TS_DATA_DIR" -type f -name '*.ts' | wc -l) .ts files"
else
	echo "ts corpus already harvested ($TS_DATA_DIR)"
fi

# Ensure the tsv native binary exists (built from the sibling tsv repo).
TSV_BIN="${TSV_BIN:-../tsv/target/release/tsv}"
if [ ! -x "$TSV_BIN" ]; then
	if [ -f "../tsv/Cargo.toml" ]; then
		echo "Building tsv release binary..."
		cargo build --release -p tsv_cli --manifest-path ../tsv/Cargo.toml
	else
		echo ""
		echo "tsv binary not found at $TSV_BIN and ../tsv is not present."
		echo "Build it ('cargo build --release -p tsv_cli' in the tsv repo) or set TSV_BIN."
	fi
else
	echo "tsv binary present ($TSV_BIN)"
fi

echo ""
echo "Setup complete! Run 'pnpm run bench' to start benchmarking."
