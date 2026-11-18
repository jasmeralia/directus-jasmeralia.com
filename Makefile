.PHONY: lint lintfix lint-site lint-builder test-site lint-docker lint-shell

lint: lint-site lint-builder lint-docker lint-shell

lintfix:
	cd site && npm run lint -- --fix
	site/node_modules/.bin/eslint --fix builder/*.mjs

lint-site:
	cd site && npm run lint

lint-builder:
	site/node_modules/.bin/eslint builder/*.mjs

test-site:
	cd site && npm test

lint-docker:
	hadolint builder/Dockerfile

lint-shell:
	shellcheck builder/run-build.sh scripts/publish-site.sh
