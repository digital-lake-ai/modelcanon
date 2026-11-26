# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.1.x` | Yes |

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub Security Advisories on `digital-lake-ai/modelcanon` or by emailing `dev@digital-lake.ai`. Do not open public issues for unpatched vulnerabilities.

ModelCanon never executes remote code, never writes to stdout during MCP transport, enforces strict HTTP `GET` byte limits (`maxBytes`), and runs Python `uvx` wrappers with `shell=False`.
