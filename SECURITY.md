# Security Policy

## Supported Versions

Security fixes are released for the latest version of Proofyard only.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately through
[GitHub's private vulnerability reporting](https://github.com/proofyard/proofyard/security/advisories/new).

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce
- Any suggested fixes or mitigations

Proofyard is a test library: it runs your app's code in `bun test`, not in production.
Relevant issues include, for example, code or files outside the test's app being read or executed,
secrets leaking into test output or caches (`PROOFYARD_CACHE_DIR`), and vulnerabilities in dependencies
that Proofyard installs.

## Response

We aim to acknowledge reports within 5 business days and to keep you updated until the issue is
resolved. After a fix is released, we will publish a
[security advisory](https://github.com/proofyard/proofyard/security/advisories).
With your permission, we will credit you in the advisory.
