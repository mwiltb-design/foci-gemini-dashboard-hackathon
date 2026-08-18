# Pi Dashboard Plugin SDK v1

This package is the versioned, browser-safe contract shared by Dashboard host validation, plugin authors, and fixtures. It contains no private Dashboard implementation imports.

## Current accepted package shape

SDK v1 validates permission-free static frontend packages:

```json
{
  "schemaVersion": 1,
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "dashboardVersion": ">=0.9.0",
  "description": "Example",
  "entry": { "frontend": "index.html" },
  "navigation": { "label": "Example", "icon": "□" },
  "permissions": []
}
```

New repository installs and upgrades must declare `dashboardVersion`; incompatible ranges are rejected before approval. Previously installed beta packages without a range remain visible so an update does not silently discard their code, enablement, or retained data.

The host currently passes an empty supported-permission list. Known future permission names are defined so packages can be reviewed against a stable vocabulary, but any nonzero permission is rejected until the matching host service and isolation boundary are implemented.

Trusted bundled plugins may request an allowlisted Dashboard navigation action with a validated host message. The first supported target is `session:<session-id>`, which resumes that exact Dashboard Chat session. Repository-installed static plugins cannot invoke host navigation. Unknown targets and malformed IDs are ignored.

Exports include:

- manifest schema/version constants and TypeScript types;
- safe relative-path and manifest validation;
- semantic plugin-version comparison; and
- bounded plugin-to-host message validation and allowlisted navigation-target parsing.

## Static lifecycle

Repository packages are reviewed at a pinned Git commit and approved by digest. A newer semantic version from the same approved repository may be upgraded. Dashboard keeps one prior code package for reversible rollback, temporarily denies the plugin during an atomic code swap, and preserves enablement afterward.

Removal always deletes installed and rollback code. Plugin data is a separate explicit choice: **Remove, keep data** or **Remove + delete data**. Static v1 plugins have no data permission, but the lifecycle boundary is established before stateful plugins arrive.

## Bundled backend boundary

Trusted bundled manifests may declare `entry.backend.protocol: "http-unix-v1"` and known narrow permissions. The host exposes only `/api/plugins/:pluginId/runtime/*`, verifies installed/enabled bundled ownership, applies normal authentication/origin checks, strips browser credentials, bounds request/response sizes and time, and forwards to `/run/pi-dashboard-plugins/:pluginId/:pluginId.sock`. Repository-installed packages cannot declare backend entries or nonzero permissions.

This contract does not itself start a plugin service. Each stateful bundled plugin still needs a separately restricted service/container with only its code, namespaced data, and private socket mounted. Dashboard refuses enablement until `GET /_health` on that socket confirms the exact plugin ID and installed version.

Trusted bundled plugins may declare immutable instruction packages under `agent.skills`. Each entry points to a package directory containing `SKILL.md`. Instruction-only skills follow plugin enablement; a skill with `access: "read"` or `"write"` also requires the matching PI grant and matching declared tool class.

Bundled backends may also declare optional PI tools under `agent.tools`. Every tool has a bounded JSON object parameter schema, an `/agent/*` runtime path, and an explicit `read` or `write` classification. Dashboard enablement, PI read access, and PI write access are independent controls. PI only receives tools while the plugin is enabled and the matching access class is granted; changing either control reloads PI's skill and tool inventory.

Repository packages remain static and cannot declare Pi tools. The Plugins page can send a plugin idea or reference to Pi for authoring, and it can review a standalone repository created beneath the mounted workspace with a `workspace:<path>` source. This does not relax the repository package boundary.

Sandboxed frames retain `sandbox="allow-scripts"` without same-origin access. The host gives each enabled plugin a process-scoped, per-plugin frontend asset capability in its iframe URL so relative packaged CSS, JavaScript, fonts, and images can load without Dashboard cookies. The capability grants no API/runtime access, is denied while the plugin is disabled, cannot load another plugin's files, and rotates whenever the backend restarts.

A bundled plugin calls its own runtime by posting a validated message to its parent:

```js
parent.postMessage({
  schemaVersion: 1,
  pluginId: 'calendar',
  type: 'runtime-request',
  requestId: crypto.randomUUID(),
  method: 'GET',
  path: '/events?from=2026-01-01',
}, '*')
```

The host accepts messages only from that plugin's active frame, limits methods, paths, body size, traversal, and concurrency, and returns a `runtime-response` with the same request ID. Dashboard cookies and authentication headers are never sent to the frame or plugin service.

## Not yet supported

- repository-installed backend entries or runtime processes;
- repository-installed Pi tools;
- nonzero permissions for repository packages;
- package builds/install scripts;
- signed `.pi-plugin` artifacts;
- state migrations; or
- public marketplace distribution.

Do not represent these as available until their runtime, permission, lifecycle, and host acceptance work passes independently.
