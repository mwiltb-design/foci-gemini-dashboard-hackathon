---
name: shared-notes-overview
description: Explains how the Shared Notes plugin works and which separate PI access grants are required. Use when the user asks what Shared Notes can do or how PI access to it is controlled.
metadata:
  category: Plugin
---

# Shared Notes overview

Shared Notes is a plugin-owned list stored in the plugin's private data volume.

- The plugin must be enabled before its interface, skills, or tools are available.
- PI read access exposes the reviewed list-notes tool.
- PI write access exposes the reviewed add-note and delete-note tools.
- Enabling the plugin never grants read or write access automatically.
- Disabling the plugin preserves its data while removing its interface, skills, and tools from PI.

Direct the user to the Plugins page when access needs to change. Never imply that a missing grant can be bypassed.
