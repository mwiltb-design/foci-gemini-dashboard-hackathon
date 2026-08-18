---
name: dashboard-docs
description: Lookup and query internal Pi-Dashboard documentation, abilities, limitations, and shortcuts.
---

# Dashboard Documentation Lookup Skill

Use this skill whenever the user asks questions about how Pi-Dashboard works, what tools or abilities it has, its operational boundaries or limitations, or how to use keyboard shortcuts and slash commands.

## Documentation Structure
The documentation is located internally inside the server `docs/` directory:
- `docs/abilities.md` - Core features, capabilities, tools, and plugin options.
- `docs/limitations.md` - Context constraints, file thresholds, and isolation rules.
- `docs/shortcuts.md` - Slash commands and keyboard hotkeys.

## Guidelines
1. When asked about features, summarize directly and concisely from `abilities.md`.
2. When asked about limitations or boundaries, cite the relevant section from `limitations.md`.
3. Provide helpful keyboard shortcut tips when appropriate.
