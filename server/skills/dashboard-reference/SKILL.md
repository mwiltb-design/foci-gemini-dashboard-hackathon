---
name: dashboard-reference
description: Consult Pi Dashboard's built-in reference docs before explaining Dashboard behavior, troubleshooting Dashboard features, changing configuration, or building plugins, skills, tools, workers, or install instructions.
metadata:
  category: Dashboard
---

# Dashboard Reference

Use this skill when the user asks how the Dashboard works, how to use it, how to troubleshoot it, how to deploy it, or how to build/modify Dashboard extensions such as plugins, skills, tools, or workers.

These docs are reference material. Do not load them all by default. Read only the document that matches the task, then inspect source files only when the reference names them or when the task clearly requires code-level confirmation.

## Routing

- For a high-level explanation of what Dashboard is and how the main screens fit together, read [references/overview.md](references/overview.md).
- For plugin authoring, plugin review, hosted plugin backends, Shared Notes-style storage, or Pi plugin tools, read [references/plugin-platform.md](references/plugin-platform.md), then use the `dashboard-plugin-authoring` skill when implementation is required.
- For Google Cloud Run hosting, GCS persistent storage (`/data`), Vite/web app previewing, plugin limitations, compute resources, and scaling commands, read [references/cloud-run.md](references/cloud-run.md).
- For install, startup scripts, Tailscale Serve, ports, sandboxed workspaces, updates, and backups, read [references/operations.md](references/operations.md).
- For common broken states such as auth failures, plugin service errors, iframe/CSP errors, missing tools, Workers not starting, or Terminal issues, read [references/troubleshooting.md](references/troubleshooting.md).

## Rules

1. Treat the references as the maintained Dashboard map, not as user preference memory.
2. Prefer the referenced files over rediscovering the whole repository.
3. When changing source, verify the current implementation after reading the reference.
4. Keep user-facing explanations simple and name the concrete file or setting involved.
5. Never expose `.env` secrets, auth tokens, Pi credentials, session files, or private memory contents while explaining Dashboard behavior.
