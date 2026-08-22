---
name: dashboard-plugin-authoring
description: Build, reproduce, review, import, upgrade, or troubleshoot Pi Dashboard plugins. Use whenever the user describes a plugin they want, supplies a GitHub repository or website as a plugin/reference, asks to install trusted plugin code, or wants a plugin that Pi can read or manipulate.
---

# Dashboard Plugin Authoring

Use this bundled runtime skill as the front door for plugin work. Do not survey the whole Dashboard repository or reread the roadmap before starting.

## 1. Load the contract

Read [references/contract.md](references/contract.md) completely. It contains the supported package types, fixed file map, security boundaries, and acceptance checks.

Then inspect only the files routed by that reference. Open another Dashboard file only when a named integration point is insufficient, and explain why.

## 2. Decision Rule & Classification

Before changing any files, choose the exact path:

### ⚠️ Critical Decision Rule
- **Default for User / Workspace Plugins:** When the user asks to build, test, or install a plugin (static or agent-connected), **ALWAYS** create a standalone Git repository inside the active project workspace at `plugins/<plugin-id>`, commit the files, and provide the exact source identifier: `workspace:plugins/<plugin-id>`.
- **Bundled First-Party Plugins:** **ONLY** place files directly in Dashboard's repository `plugins/<plugin-id>` directory if the user specifically asked to create a first-party plugin distributed with the Dashboard codebase itself.

### Authoring Paths:
1. **Static Workspace Plugin:** Browser-only UI, visualization, calculator, or dashboard tool.
   - Location: Active workspace at `plugins/<plugin-id>`.
   - Manifest: `entry.frontend` (e.g. `index.html`), `permissions: []`, no `entry.backend`, no `agent`.
   - Install identifier: `workspace:plugins/<plugin-id>`.
2. **Hosted Agent-Connected Workspace Plugin:** Server logic, persistent storage, or Pi agent tools/skills.
   - Location: Active workspace at `plugins/<plugin-id>`.
   - Manifest: `entry.frontend`, `entry.backend` (`protocol: "host-module"`, `module: "server.ts"`), optional `agent.tools` (`/agent/*`), optional `agent.skills`, permissions.
   - Install identifier: `workspace:plugins/<plugin-id>`.
3. **Local Machine Plugin:**
   - Location: User local plugins directory `~/.pi/agent/plugins/<plugin-id>`.
   - Install identifier: `local:<plugin-id>`.
4. **Bundled First-Party Plugin:**
   - Location: Dashboard repository root `plugins/<plugin-id>`.
   - Discovered automatically at server startup.

If a GitHub repository or website is provided as an example, reproduce the useful behavior cleanly without copying external branding, copyrighted assets, secrets, telemetry, or unrelated dependencies.

## 3. Implement the smallest complete slice

Before editing, state the chosen path and the files you expect to touch.

**Critical Path & Git Repository Rules:**
* Workspace plugin repositories must reside strictly within the project workspace at `plugins/<plugin-id>`.
* Never attempt relative path escapes with `..` (e.g. `workspace:../...`); the Dashboard enforces strict path boundary containment for security.
* You **MUST** initialize the plugin directory as a standalone Git repository and create an initial commit:
  ```bash
  cd plugins/<plugin-id>
  git init
  git add -A
  git commit -m "feat: initial plugin commit"
  ```
  Dashboard reviews committed `HEAD` files and calculates a cryptographic SHA256 digest during installation. Uncommitted files cannot be reviewed.

**Security & Permissions:**
* Keep Dashboard enablement separate from Pi read/write grants. Give each agent operation a narrow `/agent/*` route and classify it honestly as `read` or `write`.
* Display-only plugins must not request agent tools or permissions.
* Do not add credentials, execute repository install/build scripts during review, weaken iframe isolation, expose host operating system primitives, add external network access without a requirement, or redesign the plugin platform.
* Do not commit the main Dashboard repository unless the user explicitly asks. Only commit inside the nested plugin repository `plugins/<plugin-id>`.

## 4. Verify and Hand Off

Follow the acceptance checks in [references/contract.md](references/contract.md). Test the interface and, if agent tools are present, verify tool behavior with Pi read/write grants disabled and enabled.

### Required Authoring Handoff Checklist:
Every plugin delivery must include:
1. **Package Location:** Exact path to the plugin folder (e.g. `<workspace>/plugins/<plugin-id>`).
2. **Plugin ID & Version:** Declared in `plugin.json`.
3. **Exact Source Identifier:** For workspace plugins, `workspace:plugins/<plugin-id>`; for local plugins, `local:<plugin-id>`.
4. **Exact Git Commit Hash:** Pinned commit hash from `git rev-parse HEAD`.
5. **Review & Installation Instructions:**
   - Navigate to **Plugins** → **Add plugin**.
   - Enter the source identifier under *Install a repository as-is*.
   - Click **Review repository**, inspect the files and digest, check *Trust this repository*, and click **Install plugin**.
6. **Restart Requirements:** Explicitly state: **"No Dashboard restart or rebuild required."**
7. **Pi Access Grant Instructions:** Explain how to enable the plugin in the UI and how to grant Pi **Read** or **Write** access if agent tools/skills are included.
8. **Tests Performed:** Summary of verified functionality and any untested boundaries.
