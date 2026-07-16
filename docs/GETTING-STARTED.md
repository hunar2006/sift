# Getting started

## The 90-second path

Install Sift from a checkout, then build it:

```bash
git clone https://github.com/hunar2006/sift.git
cd sift
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Try the self-contained sample first:

```bash
sift demo
```

In a repository you want to review, wire up your local defaults once:

```bash
sift setup
```

The wizard is reversible with `sift setup --remove`. Check what it found at any time with `sift doctor`.

## Daily loop

```text
agent works -> sift --watch -> a / x / R -> sift brief -> agent fixes
```

Use `sift last` for the most recent commit. Press `?` in the workbench for the keymap; use `sift tui` when you prefer the terminal.
