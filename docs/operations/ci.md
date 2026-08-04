# CI quality gates

- `.github/workflows/ci.yml` runs `vp check` (lint + typecheck), `vpr typecheck`, `vp run test`, and mobile native static analysis on pull requests and pushes to `main`.
- CI uses standard GitHub-hosted runners. It does not require Blacksmith or repository-owned runners.
- Deployments, package publishing, hosted previews, app-store builds, and GitHub releases are intentionally not automated. aqqua is installed and run locally.
