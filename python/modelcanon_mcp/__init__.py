"""Cross-platform uvx/pip wrapper for @digital-lake/modelcanon MCP server."""

from __future__ import annotations

import shutil
import subprocess
import sys
from typing import Sequence

__version__ = "0.1.0"
NPM_PACKAGE = f"@digital-lake/modelcanon@{__version__}"


def _resolve_npx() -> str:
    for candidate in ("npx", "npx.cmd"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise FileNotFoundError(
        "Node.js 'npx' executable was not found on PATH. Install Node.js >= 20 to run modelcanon-mcp."
    )


def run_modelcanon(extra_args: Sequence[str] | None = None) -> int:
    npx_bin = _resolve_npx()
    cmd = [npx_bin, "--yes", NPM_PACKAGE]
    if extra_args:
        cmd.extend(extra_args)
    completed = subprocess.run(cmd, shell=False, check=False)
    return int(completed.returncode)


def main_mcp() -> None:
    raise SystemExit(run_modelcanon(sys.argv[1:]))
