# Python package target

Status: **supported**. `pyproject.toml` builds the wheel and source distribution,
which are attached to the verified GitHub Release. The package version is derived
from the root `VERSION` file and checked before build and publication. A Python
index can later consume the same artifacts without changing the build profile.
