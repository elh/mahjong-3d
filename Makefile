.PHONY: help install dev test typecheck format format-check lint lint-biome lint-eslint knip build install-screensaver package-saver clean good bench-sim

help:
	@printf "%s\n" \
		"install                Install dependencies" \
		"dev                    Start the Vite dev server" \
		"bench-sim              Run deterministic simulation benchmarks" \
		"test                   Run tests" \
		"typecheck              Run TypeScript checks" \
		"format                 Run Biome formatter" \
		"format-check           Check formatting" \
		"lint                   Run Biome and ESLint" \
		"knip                   Run Knip workspace hygiene checks" \
		"build                  Run production build" \
		"install-screensaver    Build and install the macOS screen saver locally" \
		"package-saver          Build the macOS screen saver DMG" \
		"clean                  Remove build output" \
		"good                   Run format check, lint, knip, typecheck, tests, and build"

install:
	bun install

dev:
	bun run dev

bench-sim:
	bun run bench:sim

test:
	bun run test

typecheck:
	bun run typecheck

format:
	bun run format

format-check:
	bun run format:check

lint:
	bun run lint

lint-biome:
	bun run lint:biome

lint-eslint:
	bun run lint:eslint

knip:
	bun run knip

build:
	bun run build

install-screensaver:
	bash macos/scripts/install-saver.sh

package-saver:
	bash macos/scripts/package-dmg.sh

clean:
	bun run clean

good:
	bun run good
