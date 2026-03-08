# ────────────────────────────────────────────────────────────────────────────
# Hermes IDE — Release & Development Makefile
#
# Usage:  make help
# ────────────────────────────────────────────────────────────────────────────

SHELL := /bin/bash
VERSION := $(shell node -p "require('./src-tauri/tauri.conf.json').version")
TAG := v$(VERSION)
PRIVATE_REPO := gabrielanhaia/hermes-ide
PUBLIC_REPO := Vinci-26/hermes-ide-releases

.PHONY: help dev build test bump release-local release-local-macos release-local-linux \
        release-ci release-ci-windows release-ci-macos release-ci-linux release-ci-all \
        release-manifests release-status release-check release clean

# ═══════════════════════════════════════════════════════════════════════════
# HELP
# ═══════════════════════════════════════════════════════════════════════════

help: ## Show this help
	@echo ""
	@echo "  Hermes IDE — v$(VERSION)"
	@echo ""
	@echo "  Development"
	@echo "  ─────────────────────────────────────────────────"
	@grep -E '^[a-z].*:.*## DEV:' $(MAKEFILE_LIST) | sed 's/:.* ## DEV: /\t/' | awk '{printf "  make %-24s %s\n", $$1, substr($$0, index($$0,"\t")+1)}'
	@echo ""
	@echo "  Release — Version Bump"
	@echo "  ─────────────────────────────────────────────────"
	@grep -E '^[a-z].*:.*## BUMP:' $(MAKEFILE_LIST) | sed 's/:.* ## BUMP: /\t/' | awk '{printf "  make %-24s %s\n", $$1, substr($$0, index($$0,"\t")+1)}'
	@echo ""
	@echo "  Release — Local Builds (saves CI minutes)"
	@echo "  ─────────────────────────────────────────────────"
	@grep -E '^[a-z].*:.*## LOCAL:' $(MAKEFILE_LIST) | sed 's/:.* ## LOCAL: /\t/' | awk '{printf "  make %-24s %s\n", $$1, substr($$0, index($$0,"\t")+1)}'
	@echo ""
	@echo "  Release — CI Builds (GitHub Actions)"
	@echo "  ─────────────────────────────────────────────────"
	@grep -E '^[a-z].*:.*## CI:' $(MAKEFILE_LIST) | sed 's/:.* ## CI: /\t/' | awk '{printf "  make %-24s %s\n", $$1, substr($$0, index($$0,"\t")+1)}'
	@echo ""
	@echo "  Release — Monitoring"
	@echo "  ─────────────────────────────────────────────────"
	@grep -E '^[a-z].*:.*## MON:' $(MAKEFILE_LIST) | sed 's/:.* ## MON: /\t/' | awk '{printf "  make %-24s %s\n", $$1, substr($$0, index($$0,"\t")+1)}'
	@echo ""
	@echo "  Common Workflows"
	@echo "  ─────────────────────────────────────────────────"
	@echo "  One-command release (recommended):"
	@echo "    make bump v=0.4.0 && make release-push && make release"
	@echo ""
	@echo "  Full CI release (all 6 platforms on CI):"
	@echo "    make bump v=0.4.0 && make release-push && make release-ci-all"
	@echo ""
	@echo ""

# ═══════════════════════════════════════════════════════════════════════════
# DEVELOPMENT
# ═══════════════════════════════════════════════════════════════════════════

dev: ## DEV: Start Tauri dev mode
	npm run tauri dev

build: ## DEV: Production build (no upload)
	npm run tauri build

test: ## DEV: Run all tests (frontend + type check)
	npx tsc --noEmit && npx vitest run

# ═══════════════════════════════════════════════════════════════════════════
# VERSION BUMP
# ═══════════════════════════════════════════════════════════════════════════

bump: ## BUMP: Bump version — make bump v=0.4.0
ifndef v
	$(error Usage: make bump v=0.4.0)
endif
	npm run bump -- $(v)
	@echo ""
	@echo "  Version bumped to $(v). Now run:"
	@echo "    make release-push"
	@echo ""

release-push: ## BUMP: Push main + tag to trigger CI (builds all 6 platforms)
	git push origin main && git push origin --tags
	@echo ""
	@echo "  Pushed $(TAG). CI will build all 6 platforms."
	@echo "  Monitor: make release-watch"
	@echo ""

# ═══════════════════════════════════════════════════════════════════════════
# LOCAL BUILDS
# ═══════════════════════════════════════════════════════════════════════════

release: ## LOCAL: Full release — local macOS+Linux, CI Windows, wait, manifests
	@echo ""
	@echo "  ╔══════════════════════════════════════════════════╗"
	@echo "  ║  Hermes IDE — Full Release ($(TAG))             ║"
	@echo "  ║  macOS + Linux locally, Windows on CI           ║"
	@echo "  ╚══════════════════════════════════════════════════╝"
	@echo ""
	@echo "  Step 1/4: Building macOS + Linux locally..."
	./scripts/release-local.sh --all --skip-manifests
	@echo ""
	@echo "  Step 2/4: Triggering Windows CI..."
	gh workflow run release.yml --repo $(PRIVATE_REPO) -f platforms=windows -f tag=$(TAG)
	@echo "  Waiting 10s for CI run to register..."
	@sleep 10
	@echo ""
	@echo "  Step 3/4: Waiting for Windows CI to finish..."
	@RUN_ID=$$(gh run list --repo $(PRIVATE_REPO) --limit 1 --json databaseId -q '.[0].databaseId'); \
	echo "  Watching CI run $$RUN_ID..."; \
	gh run watch $$RUN_ID --repo $(PRIVATE_REPO) --exit-status || \
		(echo "  [FAIL] Windows CI failed. Check: gh run view $$RUN_ID --repo $(PRIVATE_REPO)" && exit 1)
	@echo ""
	@echo "  Step 4/4: Regenerating manifests..."
	./scripts/release-local.sh --manifests
	@echo ""
	@echo "  ✓ Release $(TAG) complete — all 6 platforms."
	@echo "  https://github.com/$(PUBLIC_REPO)/releases/tag/$(TAG)"
	@echo ""

release-local: ## LOCAL: Build macOS + Linux locally, sign, notarize, upload
	./scripts/release-local.sh --all

release-local-macos: ## LOCAL: Build macOS only (signed + notarized), upload
	./scripts/release-local.sh --macos

release-local-macos-fast: ## LOCAL: Build macOS only, skip notarization (testing)
	./scripts/release-local.sh --macos --skip-notarize

release-local-linux: ## LOCAL: Build Linux via Docker (x86_64 + aarch64), upload
	./scripts/release-local.sh --linux

release-manifests: ## LOCAL: Regenerate latest.json + downloads.json from release assets
	./scripts/release-local.sh --manifests

# ═══════════════════════════════════════════════════════════════════════════
# CI BUILDS (GitHub Actions)
# ═══════════════════════════════════════════════════════════════════════════

release-ci-all: ## CI: Trigger CI for all 6 platforms
	gh workflow run release.yml --repo $(PRIVATE_REPO) -f platforms=all -f tag=$(TAG)
	@echo "  Triggered CI for all platforms ($(TAG)). Monitor: make release-watch"

release-ci-windows: ## CI: Trigger CI for Windows only (x86_64 + arm64)
	gh workflow run release.yml --repo $(PRIVATE_REPO) -f platforms=windows -f tag=$(TAG)
	@echo "  Triggered CI for Windows ($(TAG)). Monitor: make release-watch"

release-ci-macos: ## CI: Trigger CI for macOS only (aarch64 + x86_64)
	gh workflow run release.yml --repo $(PRIVATE_REPO) -f platforms=macos -f tag=$(TAG)
	@echo "  Triggered CI for macOS ($(TAG)). Monitor: make release-watch"

release-ci-linux: ## CI: Trigger CI for Linux only (x86_64 + aarch64)
	gh workflow run release.yml --repo $(PRIVATE_REPO) -f platforms=linux -f tag=$(TAG)
	@echo "  Triggered CI for Linux ($(TAG)). Monitor: make release-watch"

# ═══════════════════════════════════════════════════════════════════════════
# MONITORING
# ═══════════════════════════════════════════════════════════════════════════

release-watch: ## MON: Watch the latest CI run in real-time
	@RUN_ID=$$(gh run list --repo $(PRIVATE_REPO) --limit 1 --json databaseId -q '.[0].databaseId'); \
	echo "  Watching run $$RUN_ID..."; \
	gh run watch $$RUN_ID --repo $(PRIVATE_REPO)

release-status: ## MON: Show status of latest CI run
	@gh run list --repo $(PRIVATE_REPO) --limit 5 --json databaseId,displayTitle,status,conclusion,createdAt \
		-q '.[] | "\(.status)\t\(.conclusion // "-")\t\(.displayTitle)\t\(.createdAt)"' | \
		column -t -s $$'\t'

release-check: ## MON: Show what's in the latest release on the public repo
	@echo ""
	@echo "  Release: $(TAG) on $(PUBLIC_REPO)"
	@echo "  ─────────────────────────────────────────────────"
	@gh release view $(TAG) --repo $(PUBLIC_REPO) --json assets -q '.assets[].name' 2>/dev/null | sort || echo "  (no release found)"
	@echo ""

clean: ## DEV: Remove local release artifacts
	rm -rf release-artifacts/
	@echo "  Cleaned release-artifacts/"
