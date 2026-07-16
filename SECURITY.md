# Security Policy

## Supported versions

Only the latest published 1.x version of `siftdiff` receives security fixes.

| Version | Supported |
|---|---|
| 1.x | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/hunar2006/sift/security/advisories/new):
open the repository's **Security → Report a vulnerability** form. This keeps the report
confidential until a fix is available. (No security email address is published for this
project; use the advisory form.)

Please include:

- affected version (`sift --version`) and OS,
- a minimal reproduction, and
- the impact you observed.

## What to expect

This is a small project maintained on a best-effort basis. We aim to acknowledge reports
and, where a fix is warranted, to release a patched version and publish an advisory.
There is no paid bounty.

## Scope notes

Sift is local-first by design: it runs a loopback-only server, never executes the code in
the repository under review, performs read-only git operations, sends zero telemetry, and
reaches the network only for the loopback UI/MCP and explicit `--ai` provider calls. Reports
that turn any of these guarantees into a real exposure are especially valuable.
