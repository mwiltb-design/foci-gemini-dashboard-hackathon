---
name: skill-creator
description: Design, write, validate, and register reusable Agent Skills with standardized SKILL.md frontmatter, execution instructions, scripts, and references.
metadata:
  category: Agent Capabilities
---

# Skill Creator

Use this skill when you or the user want to package a workflow, set of conventions, specialized pipeline, or domain knowledge into a reusable **Agent Skill**.

---

## 1. Skill Architecture & Standards

A skill is a self-contained directory containing instructions and optional assets that teach agents how to perform specialized tasks.

### Standard Directory Layout:
```
skills/<skill-name>/
├── SKILL.md              # (Required) Main instruction file with YAML frontmatter
├── scripts/              # (Optional) Helper scripts (Python, Node.js, Shell)
├── references/           # (Optional) Deep documentation, API manuals, architecture specs
└── examples/             # (Optional) Reference inputs, sample configs, or expected outputs
```

---

## 2. `SKILL.md` File Specification

Every skill **must** begin with standard YAML frontmatter:

```markdown
---
name: <kebab-case-skill-name>
description: <Clear 1-2 sentence description explaining WHAT the skill does and EXACTLY WHEN an agent should activate it.>
metadata:
  category: <Category Name (e.g. Science, Development, Data Pipelines, Operations)>
---

# <Skill Title>

## Overview
Brief summary of the skill's purpose and scope.

## When to Use
Bullet points describing the exact triggers, user requests, or conditions that call for this skill.

## Workflow & Step-by-Step Instructions
1. Step 1: Specific actionable instruction.
2. Step 2: Tool execution details (e.g. `run_command`, `read_file`, `write_file`).
3. Step 3: Validation and verification.

## Deliverables & Output Format
How the agent should format and report results to the user.
```

---

## 3. Skill Storage Locations

1. **Project-Level Skills (Workspace Sandboxed):**
   * **Path:** `<workspace>/.pi/skills/<skill-name>/`
   * **Scope:** Available only within this specific project; version-controlled with the repository.
2. **Global / Personal Skills:**
   * **Path:** `/data/agent/skills/<skill-name>/` (in Cloud Run) or `~/.pi/agent/skills/<skill-name>/` (on Desktop)
   * **Scope:** Available across all projects for this user.

---

## 4. Best Practices for High-Performance Skills

1. **Specific Triggers in Description:** The `description` frontmatter is how agents discover the skill. Be precise about trigger phrases (e.g. *"Use when asked to analyze LiDAR elevation TIFFs, detect craters, or query USGS 3DEP APIs"*).
2. **Deterministic Procedures:** Provide exact terminal commands, script invocations, or parameter formats rather than vague advice.
3. **Reference Large Docs:** If the skill requires detailed API schemas or reference manuals, place them under `references/<doc>.md` and link to them from `SKILL.md` rather than cramming everything into one giant file.
