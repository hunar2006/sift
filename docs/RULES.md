# Sift Rules

Sift loads deterministic YAML rules from two locations. Later files win:

1. `~/.sift/rules.yml`
2. `<repo>/.sift/rules.yml`

Invalid files are reported and skipped during analysis; Sift does not crash or stop reviewing the diff.

## Format

```yaml
version: 1
rules:
  - id: BAN_LEGACY_AUTH
    message: "Uses deprecated internal auth client"
    paths: ["src/**"]
    pattern: "legacyAuth\\."
    weight: 40
    tier: primary
adjust:
  - code: ERROR_SWALLOWED
    paths: ["src/ui/**"]
    weight: 0
```

`rules` add custom reasons named `USER_<id>`. `id` must be unique per file and use `UPPER_SNAKE`. `paths` use Sift's built-in matcher with exact paths, `*`, and `**`. `exclude` is optional. `pattern` is an optional JavaScript regex tested against added lines; omit it for path-only rules. `weight` can be `-50` to `50`; negative weights are risk reducers. `tier` is `primary` or `nit`.

`adjust` changes built-in reason weights after Sift detects them. `weight: 0` suppresses the reason. A suppressed hot signal no longer blocks mechanical grouping.

## Commands

```sh
sift rules lint
sift rules list
```

`lint` prints an OK/error report for the global and repo files and exits `1` if any existing file is invalid. `list` prints the effective merged rule set.

## Examples

Ban an internal API:

```yaml
version: 1
rules:
  - id: BAN_LEGACY_AUTH
    message: "Uses deprecated internal auth client"
    paths: ["src/**"]
    pattern: "legacyAuth\\."
    weight: 40
```

Suppress swallowed-error noise in UI code:

```yaml
version: 1
adjust:
  - code: ERROR_SWALLOWED
    paths: ["src/ui/**"]
    weight: 0
```

Treat console output as a nit:

```yaml
version: 1
rules:
  - id: CONSOLE_LOG
    message: "Console output left in app code"
    paths: ["src/**"]
    exclude: ["src/vendor/**"]
    pattern: "console\\.log"
    weight: 3
    tier: nit
```

Flag infra edits with a path-only rule:

```yaml
version: 1
rules:
  - id: INFRA_TOUCH
    message: "Infrastructure changed"
    paths: ["infra/**", ".github/workflows/**"]
    weight: 25
```

Add a risk reducer for a known-safe migration pattern:

```yaml
version: 1
rules:
  - id: SAFE_CONCURRENT_INDEX
    message: "Concurrent index build lowers migration risk"
    paths: ["db/migrations/**"]
    pattern: "CREATE INDEX CONCURRENTLY"
    weight: -10
```
