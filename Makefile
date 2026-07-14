VENV := mcp/.venv
PYTHON := $(if $(wildcard $(VENV)/bin/python),$(VENV)/bin/python,python3)
RUFF   := $(if $(wildcard $(VENV)/bin/ruff),$(VENV)/bin/ruff,ruff)
MYPY   := $(if $(wildcard $(VENV)/bin/mypy),$(VENV)/bin/mypy,mypy)
PYLINT := $(if $(wildcard $(VENV)/bin/pylint),$(VENV)/bin/pylint,pylint)
PY_SRC := mcp/scripts

.PHONY: lint lintfix lint-site lint-python lint-docker lint-shell \
        ruff ruff-format pylint mypy

lint: lint-site lint-python lint-docker lint-shell

lintfix:
	cd site && npm run lint -- --fix
	$(RUFF) check --fix $(PY_SRC)
	$(RUFF) format $(PY_SRC)

lint-site:
	cd site && npm run lint

lint-python:
	@status=0; \
	$(RUFF) format --check $(PY_SRC) || status=1; \
	$(RUFF) check $(PY_SRC) || status=1; \
	$(PYLINT) $(PY_SRC) || status=1; \
	$(MYPY) $(PY_SRC) || status=1; \
	exit $$status

ruff-format:
	$(RUFF) format --check $(PY_SRC)

ruff:
	$(RUFF) check $(PY_SRC)

pylint:
	$(PYLINT) $(PY_SRC)

mypy:
	$(MYPY) $(PY_SRC)

lint-docker:
	hadolint builder/Dockerfile

lint-shell:
	shellcheck builder/run-build.sh mcp/scripts/publish.sh
