# Pi Dashboard plugin authoring contract

This bundled reference is the maintained implementation map for plugin work. The accepted product model is authoritative: Dashboard enablement and Pi access are independent, repository installs remain static, and agent-connected plugins are trusted bundled services.

## Choose the package type

| Request | Package type | Result |
| --- | --- | --- |
| Install code the user explicitly trusts and it already has a compatible root `plugin.json` | Trusted static install | Review and approve its exact Git commit in Plugins; do not rebuild |
| UI, game, visualization, calculator, or other browser-only feature | Static repository plugin | Standalone repository under `plugins/<id>`; install with `workspace:plugins/<id>` |
| Pi must list, create, update, or delete plugin-owned records | Hosted agent-connected plugin | Frontend, hosted module, manifest tools, plugin-private storage, and host tests |
| Durable data is shared between the UI and Pi | Bundled agent-connected plugin | Same as above, even if the data model is small |
| Website or repository is an example but not a Dashboard plugin | Author from reference | Reproduce useful behavior using one of the preceding two types |

Trust changes whether compatible static code is rebuilt. It never bypasses exact-commit review, compatibility, manifest, path, size, provenance, or permission checks, and never grants backend or Pi access to a repository package.

## Read only the routed files

Always read:

- `packages/plugin-sdk/README.md` for the supported boundary.
- `packages/plugin-sdk/src/index.ts` for the authoritative manifest schema and validators.

For a static plugin, also read:

- `examples/plugins/hello/plugin.json`
- `examples/plugins/hello/index.html`
- the repository review limits near the top of `server/src/plugin-service.ts`

For an agent-connected hosted plugin, also read:

- `plugins/notes/plugin.json`
- `plugins/notes/index.html`
- `plugins/notes/app.js`
- `plugins/notes/server.ts`
- `packages/plugin-runtime/src/index.ts`
- `server/src/plugin-host.ts`
- `server/extensions/dashboard-plugin-tools.ts`
- `server/test/bundled-review-plugins.test.ts`
- `server/test/plugin-host.test.ts`
- `server/test/shared-notes-migration.test.ts`
- the plugin policy tests under `server/test/`

For manager behavior or authoring prompts, read:

- `app/src/components/PluginManager.tsx`
- the plugin-related sections of `app/src/styles.css`

Do not inspect unrelated Core views, memory, sessions, workers, packaging, or roadmap documents unless the requested change actually crosses that boundary.

## Static repository contract

A static plugin is a standalone Git repository whose root contains:

```text
plugin.json
index.html
optional browser-safe CSS, JS, fonts, and images
```

Required manifest shape:

```json
{
  "schemaVersion": 1,
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "0.1.0",
  "description": "What it does.",
  "dashboardVersion": ">=0.9.0-beta.1 <1.0.0",
  "entry": { "frontend": "index.html" },
  "navigation": { "label": "Example", "icon": "◇" },
  "permissions": []
}
```

Rules:

- IDs are lowercase letters, numbers, and single hyphens, begin with a letter, and are at most 48 characters.
- Use semantic versions and a compatible `dashboardVersion`.
- Keep paths relative and forward-slashed.
- Repository packages cannot declare `entry.backend`, `agent`, or permissions.
- The iframe is opaque-origin and sandboxed with scripts only. Packaged relative assets load through a process-scoped, per-plugin host capability; do not depend on same-origin storage, Dashboard cookies, direct host DOM access, or remote assets.
- Prefer plain HTML/CSS/JS with local assets. There is no package install or build step during Dashboard review.
- Repositories may contain only non-executable regular files: at most 200 files and 5 MB total, with no file over 5 MB.
- Never include secrets, symlinks, submodules, generated dependency trees, analytics, or remote executable code.
- Initialize a nested Git repository and make a local commit only after validation. Dashboard reviews committed `HEAD`, not uncommitted files.

## Hosted agent-connected contract

Use this only for trusted first-party code maintained with Dashboard.

The manifest may add:

```json
{
  "entry": {
    "frontend": "index.html",
    "backend": { "protocol": "host-module", "module": "server.ts" }
  },
  "agent": {
    "skills": [
      {
        "name": "review-items",
        "description": "Review the plugin items without changing them.",
        "path": "skills/review-items",
        "access": "read"
      }
    ],
    "tools": [
      {
        "name": "list_items",
        "label": "List items",
        "description": "List the plugin items visible to the user.",
        "access": "read",
        "method": "GET",
        "path": "/agent/items",
        "parameters": {
          "type": "object",
          "properties": {},
          "additionalProperties": false
        }
      }
    ]
  },
  "permissions": ["plugin-data:read", "plugin-data:write"]
}
```

Rules:

- Plugin-owned skills live inside the bundled plugin at `skills/<skill-name>/SKILL.md` and are declared in `agent.skills`.
- Instruction-only plugin skills follow plugin enablement. Skills declaring `read` or `write` access appear to PI only when the matching grant is active.
- Plugin skills are immutable package code. Do not copy them into personal or project skill storage or make them individually toggleable.

- Tools require a backend. Use 1–24 unique narrow tools with lowercase names.
- Tool paths must begin `/agent/`. Parameters must be bounded object schemas using only string, number, integer, or boolean properties and `additionalProperties: false`.
- `read` means observation only. Any creation, mutation, deletion, send, or external effect is `write`.
- Reuse the same service handler for UI and agent routes only when authorization and validation remain equivalent.
- Persist only in the plugin's private host storage. Use `context.storage.transaction(...)` for read-modify-write operations, write atomically, and bound record counts and field sizes.
- Use `server/src/plugin-host.ts` APIs: `context.json(...)`, `request.json()`, and plugin-private storage. Do not reach into Dashboard credentials, sessions, memories, or unrelated plugin data.
- The frontend reaches its runtime only through the validated parent `postMessage` bridge. It never receives Dashboard credentials.
- Trusted bundled frontends may request an allowlisted host navigation target such as `session:<session-id>`; repository-installed static plugins cannot navigate the host. Unknown or malformed targets are ignored.
- Enabling the plugin must not automatically grant Pi access. Pi read and write grants remain separate user choices.
- Disabling preserves plugin data and revokes UI/runtime/tool availability.

Do not make a third-party repository agent-connected by relaxing validation. Repository plugins may use hosted modules only through the reviewed hosted repository path; never allow the old `http-unix-v1` sidecar protocol for repository installs.

## Reference handling

When given a GitHub URL:

1. Determine whether it is already a compatible static Dashboard plugin.
2. If it is and the user explicitly trusts it, use exact-commit review rather than rebuilding.
3. Otherwise treat it as a behavioral reference. Inspect only files needed to understand that behavior.
4. Check its license before copying code. Without a compatible license, implement behavior independently.
5. Exclude branding, copyrighted assets, telemetry, credentials, hosted services, and unrelated features.

When given a website, study visible behavior and public documentation. Do not attempt to bypass authentication, copy private data, or reproduce protected branding/assets.

## Acceptance checks

For every plugin:

- Validate `plugin.json` against `packages/plugin-sdk/src/index.ts`.
- Confirm the frontend entry and every referenced local asset exist.
- Test empty, normal, long, and invalid inputs.
- Verify the UI at narrow and wide sizes and confirm iframe errors are visible.
- Run `npm run build` in `app`.
- Run `npm run build` in `server`.

For static repository plugins:

- Confirm `git status` is clean inside the nested repository.
- Review through `workspace:plugins/<id>`.
- Verify exact commit, files, size, compatibility, install-disabled behavior, enable/open, disable denial, upgrade, rollback, and removal when lifecycle code changed.
- Confirm no backend, agent tools, permissions, executable files, symlinks, or build/install execution.

For hosted agent-connected plugins:

- Add focused manifest/service tests modeled on `server/test/bundled-review-plugins.test.ts`.
- Run plugin host, plugin service, asset policy, SDK, and dynamic tool-extension tests.
- Verify no hosted module is loaded while inactive.
- Verify persistence across restart, disable without deletion, and explicit retained-data deletion.
- In chat, verify tools are absent with grants off, read tools appear only with read access, and mutations fail until write access is granted.
- Exercise every tool once through Pi and confirm the UI shows the same state.
