# Fuzz regression fixtures

Named `.patch` files here are permanent reproductions of bugs found by `pnpm fuzz`.
They are loaded before property runs and must keep parsing/analyzing without throw.
