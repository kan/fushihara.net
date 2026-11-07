# Security Policy

## Reporting a Vulnerability

If you find a vulnerability in fushihara.net, do not open a public issue. Report it through GitHub's [Private vulnerability reporting](https://github.com/kan/fushihara.net/security/advisories/new) instead. Only the maintainer can see the report until a fix is published.

Please include:

- What the vulnerability is
- Steps to reproduce it
- The expected impact (which data can be read or written, which permissions are needed, and so on)

Reports are checked and answered as soon as possible.

## Scope

In scope are the code in this repository (the latest `main` branch) and the sites deployed from it: the portfolio at <https://fushihara.net/> and the blog under `/blog/`. There are no release versions, so fixes are not applied to older commits.

Please report these elsewhere:

- Problems in the sticky-note board library wema: [kan/wema](https://github.com/kan/wema/security/policy)
- Problems in the lily CMS itself (not in how this site uses it): [kan/lily](https://github.com/kan/lily/security/policy)
- Vulnerabilities in other dependencies: the project that publishes the dependency
