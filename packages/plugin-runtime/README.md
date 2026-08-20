# Pi Dashboard bundled plugin runtime

This library is the first-party service contract for stateful bundled plugins. It does not run inside the Dashboard backend and does not discover or execute repository-installed code.

A plugin service supplies a stable ID, version, private Unix socket, namespaced data directory, and request handler. The runtime provides:

- data-directory creation only when the plugin service starts;
- a private Unix socket named `<pluginId>.sock`, mode `0600` by default or `0660` when a dedicated cross-container group is required;
- startup refusal when that socket is active or its path is a non-socket, preventing takeover or unsafe unlinking;
- required `x-pi-dashboard-plugin-id` verification;
- built-in `GET /_health` identity/version/start-time response;
- 1 MB request and 2 MB response limits;
- bounded header/request timeouts;
- bounded JSON parsing and errors; and
- idempotent graceful `SIGTERM`/`SIGINT` shutdown.

The execution environment, not this library, enforces process boundaries:

- one restricted runtime process per stateful bundled plugin;
- only that plugin's writable data directory and socket;
- no Pi agent state, provider credentials, Dashboard token, sessions, or unrelated project files;
- no network unless a separately approved destination policy requires it; and
- process resource limits where supported.

Inactive plugins must not start their service or call `startPluginRuntime()`, so they create no socket or data directory.
