# CLAUDE.md - Stock Analyzer Core Guide

**Created**: 2025-10-19
**Last updated**: 2026-02-22 (path correction)
**Purpose**: Mandatory rules for Claude Code work

---

## Quick Reference

### Required File-Read Triggers

**Required at the start of every session**:
1. **CLAUDE.md** (this file) - core principles
2. **docs/CLAUDE_PROTOCOLS.md** - run the session-start protocol
3. **docs/Sprint*_*/SPRINT*_MASTER_PLAN.md** - understand current work

**Required before file work**:
- **docs/CLAUDE_PROTOCOLS.md** - file-work verification protocol

**When project reference is needed**:
- **docs/PROJECT_REFERENCE.md** - directory structure, data, and workflow

---

## Absolute Work Path

```text
source/100xFenok/tools/stock_analyzer/ (relative to the project root)
```

**CRITICAL**: Work only in this path. Never use any other path.

**Wrong paths (never use)**:
- `fenomeno_projects/`
- `fenomeno_knowledge/`
- any other relative path

---

## Project Overview

**Stock Analyzer - 100xFenok Project**
- Sprint 4: 5 modules complete (93/93 tests, 100%)
- Sprint 5: 2 modules implemented; testing incomplete (20/85, 24%)
- Sprint 6: 2 modules planned (EconomicIndicators, ETFAnalytics)
- Goal: system scalable up to 10,000 companies

---

## User Absolute Principles (4)

### Principle 1: Testing Philosophy
**"Testing means checking whether everything runs smoothly."**

- Test with the full dataset (1,249 -> 10,000 expansion)
- Never reduce or slice test data; do not use `.slice()`
- Do not reduce data when tests fail
- Test failure -> fix the system so it passes

### Principle 2: Scalability First
**"Scale to 10,000 without stopping."**

- Design architecture so loading and performance do not slow down
- Keep the system working properly even as modules increase
- Build a system that makes the failing path work
- Improve the system instead of reducing requirements

### Principle 3: Execute After Complete Understanding
**"Understand every plan, workflow, situation, and document."**

- Briefing is required before work
- Establish a workflow for identifying problems
- No ad hoc work without a plan
- Follow the SuperClaude SC agent workflow

### Principle 4: Obey Absolute Principles
**"In every situation, follow the absolute principles I gave."**

- Do not violate principles for convenience or speed
- Test failure -> improve the system instead of reducing data
- Performance issue -> optimize to O(n) instead of reducing requirements
- Increased complexity -> improve architecture instead of removing features

---

## Phase 0 Principles (5)

**CRITICAL**: Required before starting a new project or large data task.

### Principle 1: Fully Understand All Data
**"Do not infer the whole from samples only."**

- Analyze every data source in detail
- Distinguish base data from computed outputs
- Classify required vs optional data
- Do not infer the full structure from partial samples
- Do not start development while data relationships are unclear

### Principle 2: Verify The Transformation Pipeline
**"Guarantee source -> intermediate -> final accuracy."**

- Verify source data (xlsb, xlsx) -> CSV conversion
- Test multiple versions and weekly samples
- Use automatic validation logic (record count, field count, encoding)
- Do not run a one-time conversion without validation

### Principle 3: Documentation First
**"Complete references save future time."**

- Fully document the entire data structure
- Keep detailed documents for future reference
- Record decision evidence
- Do not proceed from mental understanding only

### Principle 4: No Premature Development
**"Skipping Phase 0 costs twice as much time later."**

- Start development only after fully understanding the data
- Proceed sequentially: Phase 0 -> Phase 1 -> Phase 2
- Do not start coding after only partial data review
- Do not use a "learn while building" approach

**Phase 0 is required if any condition applies**:
1. Starting a new project
2. More than 5 data sources
3. Unclear data relationships
4. Unverified transformation pipeline
5. Incomplete understanding of the full data structure

### Principle 5: Plan First, Document First
**"Plan update -> development -> retrospective cycle."**

- New finding -> immediately review the plan
- Update MASTER_PLAN first
- Update docs before development
- Do not develop first and document later
- Do not ignore the plan and work ad hoc

---

## Required Checklist Before Starting Work

**CRITICAL**: Check these 4 steps before every task.

### Step 1: Check Whether Sub-Agents Are Needed

| Work type | Recommended agent | Assignment condition |
|----------|-------------------|----------------------|
| **Architecture design** | @system-architect | New module, structure design |
| **Performance optimization** | @performance-engineer | O(n^2) -> O(n), bottleneck fix |
| **Root cause analysis** | @root-cause-analyst | Bug, failure root cause tracing |
| **Test writing** | @quality-engineer | Unit/E2E tests |
| **Code refactoring** | @refactoring-expert | Code cleanup, technical debt |
| **Documentation** | @technical-writer | API docs, guides |

**Assignment criteria**:
- Complexity > 0.7 -> Task agent required
- 3 or more files changed -> specialist agent
- Performance critical -> @performance-engineer

### Step 2: Select Mode

| Mode | Activation condition | Effect |
|------|----------------------|--------|
| **--task-manage** | 3 or more steps | Structured management, automatic TodoWrite |
| **--orchestrate** | Parallelizable work | Tool optimization, parallel execution |
| **--think-hard** | Complex analysis | Deep reasoning, about 10K tokens |
| **--delegate** | >7 dirs OR >50 files | Parallel sub-agent handling |

### Step 3: Use MCP Servers

| MCP server | When to use | Benefit |
|------------|-------------|---------|
| **Sequential** | Structural analysis, multi-step reasoning | Structured thinking, evidence-based |
| **Playwright** | Browser testing | Real browser E2E |
| **Context7** | Pattern/document reference | Official docs, best practices |

### Step 4: Assess Parallel Execution

**Parallel execution conditions**:
- No dependency between tasks
- No file conflict
- Independently verifiable

---

## Prohibitions Summary

### Paths
- Do not work in `fenomeno_projects/` or `fenomeno_knowledge/`
- Do not use relative paths
- Use absolute paths only

### Testing
- Do not reduce test data with `.slice()`
- Do not reduce data when tests fail
- Do not skip or disable tests
- Verify with the full dataset
- Make the system pass by improving it

### File Work
- Do not delete whole folders with `rm -rf`
- Do not delete without user confirmation
- Do not mass-delete without backup
- Delete files selectively
- Require explicit user confirmation

### Development
- Do not skip Phase 0
- Do not work ad hoc without a plan
- Do not only analyze docs without creating required outputs
- Do not miss MASTER_PLAN updates
- Follow the plan -> docs -> development order
- Update MASTER_PLAN immediately after work completion

---

## Related Documents (Required Reading)

### Required At Session Start
1. **CLAUDE.md** (this file)
2. **docs/CLAUDE_PROTOCOLS.md**
   - Session-start protocol (5 steps)
   - File-work verification protocol (3 steps)
   - MASTER_PLAN update protocol
3. **Current Sprint MASTER_PLAN.md**
   - docs/Sprint4_DataIntegration/SPRINT4_MASTER_PLAN.md
   - docs/Sprint5_*/SPRINT5_MASTER_PLAN.md (if present)
   - docs/Sprint6_EconomicETF/SPRINT6_MASTER_PLAN.md

### Reference During Work
- **docs/PROJECT_REFERENCE.md** - project structure, data, workflow
- **docs/Sprint*_DataIntegration/FULL_DATA_ANALYSIS_AND_ROADMAP.md** - full roadmap

---

## Quick Work Checklist

### At Session Start
- [ ] Check `pwd` (correct path?)
- [ ] Read CLAUDE.md
- [ ] Run `CLAUDE_PROTOCOLS.md` session-start protocol
- [ ] Understand current MASTER_PLAN state
- [ ] Check Git status
- [ ] Write a briefing

### During File Work
- [ ] Run `CLAUDE_PROTOCOLS.md` file-work verification protocol
- [ ] Verify path (`pwd`)
- [ ] Check contents (`ls -la`)
- [ ] Ask for user confirmation

### During Task Work
- [ ] Read MASTER_PLAN before starting
- [ ] Create/update TodoWrite
- [ ] Edit MASTER_PLAN after completion
- [ ] Clean temporary files

### Before Git Commit
- [ ] Full test suite passes
- [ ] Documentation updated
- [ ] Wrong-path files removed
- [ ] CLAUDE.md/PROTOCOLS compliance verified

---

## SuperClaude SC Agents

- `@root-cause-analyst`: root cause analysis
- `@performance-engineer`: performance optimization
- `@quality-engineer`: testing and quality assurance
- `@system-architect`: system architecture design
- `@technical-writer`: API docs, guides

---

**Last updated**: 2026-02-22 (path correction)
**Author**: Claude Code (Sonnet 4.5)
**Project**: Stock Analyzer - 100xFenok
**Sprint**: Sprint 5 (testing incomplete) -> Sprint 6 preparation

---

**Read this document and CLAUDE_PROTOCOLS.md at the start of every session.**
