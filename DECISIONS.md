# Decisions

## 2026-07-09

- Chose a hand-rolled unified diff parser instead of `parse-diff` so Sift can meet the exact parser edge cases in the v0.1 spec without adapting a third-party model.
- Kept `@tailwindcss/vite` out of the dependency graph and used Tailwind v4 through CSS-compatible utility classes plus hand-authored CSS. This keeps the build dependency list closer to the allowlist while preserving the intended UI style.
- Used OpenAI `gpt-4.1-mini` as the optional OpenAI annotation default. It is only reached when `--ai=openai` or `--ai` resolves to OpenAI and `OPENAI_API_KEY` is present.
