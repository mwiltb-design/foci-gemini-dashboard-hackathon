---
name: dashboard-plugin-authoring
description: Build, reproduce, review, import, upgrade, or troubleshoot Pi Dashboard plugins. Use whenever the user describes a plugin they want, supplies a GitHub repository or website as a plugin/reference, asks to install trusted plugin code, or wants a plugin that Pi can read or manipulate.
---

# Dashboard Plugin Authoring

Use this bundled runtime skill as the front door for plugin work. Do not survey the whole Dashboard repository or reread the roadmap before starting.

## 1. Load the contract

Read [references/contract.md](references/contract.md) completely. It contains the supported package types, fixed file map, security boundaries, and acceptance checks.

Then inspect only the files routed by that reference. Open another Dashboard file only when a named integration point is insufficient, and explain why.

## 2. Classify before changing files

Choose exactly one path:

- **Trusted static install:** The supplied repository already is a compatible Dashboard plugin and the user explicitly trusts its code. Do not rebuild it. Review the exact commit through the Plugins page and let the user approve installation.
- **Static workspace authoring:** The plugin is interface-only and needs no Pi tools, hosted server logic, or durable shared state. Build a standalone Git repository inside the current project workspace under `plugins/<plugin-id>` for `workspace:plugins/<plugin-id>` review.
- **Local machine authoring:** Build a plugin in the user's private local plugins directory `~/.pi/agent/plugins/<plugin-id>` for `local:<plugin-id>` review.
- **Hosted agent-connected authoring:** Pi must read or change plugin data, or the plugin needs durable shared state/server logic. Build a trusted plugin with a hosted backend module and plugin-private storage. Never imply that unreviewed code can gain backend or Pi access.

If a GitHub repository or website is only an example, reproduce the useful behavior without copying branding, copyrighted assets, secrets, analytics, or unrelated dependencies.

## 3. Implement the smallest complete slice

Before editing, state the chosen path and the files you expect to touch.

**Critical Path & Security Rules:**
* Workspace plugin repositories must reside strictly within the project workspace at `plugins/<plugin-id>`.
* Never attempt or instruct relative path escapes with `..` (e.g. `workspace:../...`); the Dashboard enforces strict path boundary containment for security.
* Initialize the plugin directory with `git init` and an initial commit (`git commit`) so exact commit hashing and digest verification succeed.

Keep Dashboard enablement separate from Pi read/write grants. Give each agent operation a narrow `/agent/*` tool and classify it honestly as `read` or `write`. Display-only plugins such as games must not request agent access.

Do not add credentials, execute repository install/build scripts during review, weaken iframe isolation, mount broad Dashboard state, expose the Docker socket, add network access without a demonstrated requirement, or redesign the plugin platform.

Do not commit the main Dashboard repository or push anything unless the user explicitly asks. A new standalone static plugin may receive the local Git commit required for exact-commit review; report that commit clearly.

## 4. Verify and hand off

Run the routed tests in the contract. Also test the user-visible interface and, when present, every Pi read/write tool through chat with grants disabled and enabled.

Finish with:

- what was built or reviewed;
- where it lives (`plugins/<plugin-id>` inside the workspace or `~/.pi/agent/plugins/<plugin-id>`);
- what Pi can and cannot access;
- tests performed and any untested boundary;
- for static workspace plugins, the exact `workspace:plugins/<plugin-id>` to enter in Plugins;
- for local plugins, the exact `local:<plugin-id>` to enter in Plugins;
- for hosted authoring, the rebuild/restart and Plugins-page activation steps.
