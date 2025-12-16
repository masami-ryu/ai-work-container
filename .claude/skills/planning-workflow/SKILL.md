---
name: planning-workflow
description: Create executable implementation plans for software development tasks. Use when user asks to create a plan, requests task breakdown, mentions planning, or needs structured approach for implementation.
---

# Planning Workflow

## Overview

Create structured, executable implementation plans based on task complexity:
- **Express**: 2 files or fewer, limited scope
- **Standard**: 3-10 files, moderate complexity
- **Comprehensive**: Architectural changes, many files affected

## Quick Start

When user requests a plan, follow these steps:

1. **Assess Task Scope**: Determine workflow type based on complexity
2. **Clarify Objectives**: Confirm user requirements and goals
3. **Gather Information**: Investigate codebase, docs, and dependencies
4. **Use MCP Tools**: Leverage latest information when needed
5. **Create Plan**: Break down into concrete, measurable steps
6. **Validate Quality**: Ensure completeness and actionability
7. **Save**: Store in `ai/plans/YYMMDD_[task-summary].md`

## Plan Structure

Use template from [TEMPLATE.md](TEMPLATE.md):
- Overview with purpose, scope, and prerequisites
- Requirements and constraints
- Phase-based implementation steps
- Test plan
- Success criteria
- Risk mitigation

## Quality Checklist

- [ ] All requirements reflected
- [ ] Actions start with specific verbs
- [ ] Completion criteria are measurable
- [ ] Dependencies identified
- [ ] Risks and mitigations defined

## MCP Tools for Planning

### Documentation Research
```
# Microsoft/Azure best practices
mcp__msdocs__microsoft_docs_search
  query: "relevant technology best practices"

# Code examples
mcp__context7__resolve-library-id
  libraryName: "library-name"
```

### Code Analysis
```
# Find existing patterns
mcp__serena__find_symbol
  name_path_pattern: "PatternName"

# Understand structure
mcp__serena__get_symbols_overview
  relative_path: "path/to/file"
```

## Output Format

- Language: Japanese
- File naming: `YYMMDD_[task-summary].md`
- Location: `ai/plans/`
- Template compliance: Required

See [TEMPLATE.md](TEMPLATE.md) for detailed structure.
