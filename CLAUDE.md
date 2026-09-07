# Tessera

Block Settlement Protocol (BSP) v0.1 — prepaid block settlement for continuous
compute on Hedera x402. Built for ETHOnline 2026, Hedera AI & Agentic Payments track.

- Canonical protocol: `SPEC.md` (in-repo, committed).
- Execution plan: `IMPLEMENTATION-PLAN.md`, at the repo root beside `SPEC.md`
  (**committed** — the team reads it).
- Team split: `docs/TEAM-SPLIT.md` (local only, gitignored).

## Commit rules — non-negotiable

- **No co-authors.** Never add a `Co-Authored-By:` trailer to any commit. Not for
  Claude, not for anyone. Commit messages end at the last line of the body.
- **No tool attribution.** No "Generated with Claude Code", no 🤖 line, no
  attribution footer in commit messages or PR bodies.
- **Author is always the `princepanwar2k3` account** —
  `princepanwar2k3 <princepanwar2k3@gmail.com>`. Already set as repo-local git
  config. Do not override it with `--author`, and never fall back to the global
  identity (`Prince-webmob <prince.panwar@webmobinfo.ch>`) — different account.
- **SSH identity.** The repo is pinned to that account's key via local
  `core.sshCommand` (`~/.ssh/id_prince2k3`), so a plain `github.com` remote pushes
  as the right account. The `github-prince2k3` host alias in `~/.ssh/config` works
  too — either is fine, but do not push over the default office key.

Verify before pushing:

```sh
git config user.name && git config user.email
git log --format='%an <%ae>%n%b' -5 | grep -i 'co-authored\|generated with' && echo "BAD" || echo "clean"
```

## Repo conventions

- pnpm workspace, Node >= 20, TypeScript strict (`tsconfig.base.json`).
- `packages/core` and `packages/protocol` are test-first (strict TDD). Everything
  else gets smoke tests plus the `tools/e2e` harness.
- Dependency rule: `core` depends only on `protocol`, and nothing depends on `daemon`.
- Never commit `.env`, keys, or operator credentials. `.env.example` only.
- `CLAUDE.md` and `docs/` are gitignored on purpose. Do not `git add -f` them.

## Scope discipline

The implementation plan's cut list only ever removes. Nothing gets added that is
not in the plan.
