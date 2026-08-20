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

# The same parser.ts for bench-tsv-delivery (tsv native vs WASM). Its own copy,
# like bench-ts-only's second Outline clone, so each scenario resets its own tree
# rather than sharing a corpus with a scenario that also rewrites it. Copied from
# the download above when it's there — the URL is pinned to v5.9.2, so the copy
# and a fresh download are the same bytes.
if [ ! -f "bench-tsv-delivery/data/parser.ts" ]; then
	echo "Preparing parser.ts for the tsv delivery benchmark..."
	mkdir -p bench-tsv-delivery/data
	if [ -f "bench-large-single-file/data/parser.ts.bak" ]; then
		cp bench-large-single-file/data/parser.ts.bak bench-tsv-delivery/data/parser.ts.bak
	else
		curl -o bench-tsv-delivery/data/parser.ts.bak https://raw.githubusercontent.com/microsoft/TypeScript/refs/tags/v5.9.2/src/compiler/parser.ts
	fi
	cp bench-tsv-delivery/data/parser.ts.bak bench-tsv-delivery/data/parser.ts
	echo "Prepared parser.ts for the tsv delivery benchmark (TypeScript v5.9.2)"
else
	echo "parser.ts for the tsv delivery benchmark already exists"
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

# Clone Outline again for the tsv-fair benchmark (bench-ts-only). A separate
# checkout from bench-js-no-embedded's so each scenario resets its own tree.
#
# tsv formats the JS/TS family but has no JSX/TSX parser, so this scenario scopes
# every formatter to Outline's non-JSX subset (.ts/.js/.mjs) — the common set all
# five support — keeping the head-to-head apples-to-apples. Outline is third-party
# code no formatter here has already shaped, so no tool is measured on its own
# output.
if [ ! -d "bench-ts-only/data" ]; then
	echo "Cloning Outline repository for the ts-only benchmark..."
	git clone --depth=1 https://github.com/outline/outline.git bench-ts-only/data
else
	echo "Outline repository for ts-only already exists"
fi

# Build the Svelte corpus for bench-svelte (tsv vs rsvelte-fmt, .svelte only).
# Sibling checkouts (../kit, ../svelte.dev) plus cloned Svelte component
# libraries (layerchart, svelte-ux, flowbite-svelte, svelte-maplibre, layercake),
# snapshotted with fixtures
# pruned into a git-init'd data/ tree — see bench-svelte/setup-corpus.mjs.
SVELTE_CORPUS_FAILED=""
if [ ! -d "bench-svelte/data" ]; then
	echo "Building Svelte corpus for bench-svelte..."
	# Needs the ../kit and ../svelte.dev sibling checkouts. Without them this is
	# the one setup step that can't complete, so record it and say so at the end
	# rather than letting "Setup complete!" paper over it.
	node ./bench-svelte/setup-corpus.mjs || SVELTE_CORPUS_FAILED="1"
else
	echo "Svelte corpus for bench-svelte already exists"
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
if [ -n "$SVELTE_CORPUS_FAILED" ]; then
	echo "Setup complete EXCEPT the Svelte corpus — bench-svelte will fail and be skipped."
else
	echo "Setup complete! Run 'pnpm run bench' to start benchmarking."
fi
