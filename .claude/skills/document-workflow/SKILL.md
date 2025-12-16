---
name: document-workflow
description: Create or update technical documentation including README files, guides, and tutorials. Use when user asks to create documentation, update docs, write README, or mentions documentation needs.
---

# Document Workflow

## Overview

Create and update technical documentation for projects, following best practices for clarity and completeness.

## Quick Start

When user requests documentation, follow these steps:

1. **Confirm Purpose**: Clarify documentation goal and target audience
2. **Check Existing**: Review related existing documentation
3. **Gather Information**: Collect necessary info from code, configs, and external resources
4. **Use MCP Tools**: Leverage latest information when needed
5. **Create/Update**: Write or update documentation
6. **Save**: Store in appropriate location

## Document Structure

```markdown
# [Title]

## Overview
[Brief description]

## Prerequisites
- [Required knowledge/environment]

## Steps
1. [Step 1]
2. [Step 2]

## Examples
[Code examples or screenshots]

## Troubleshooting
- Problem: [Issue description]
  Solution: [Resolution]

## References
- [Related documentation]
```

## Document Types

### README Files
- Project overview
- Installation instructions
- Quick start guide
- Usage examples
- Contributing guidelines

### Technical Guides
- Setup instructions
- Configuration guides
- API documentation
- Architecture diagrams

### Tutorials
- Step-by-step walkthroughs
- Learning paths
- Best practices
- Common patterns

## Storage Locations

- General docs: `docs/`
- Plans: `ai/plans/`
- Templates: `ai/templates/`
- Project root: `README.md`, `CONTRIBUTING.md`

## MCP Tools for Documentation

### Research Best Practices
```
# Microsoft documentation standards
mcp__msdocs__microsoft_docs_search
  query: "documentation best practices"

# Find code examples
mcp__context7__resolve-library-id
  libraryName: "relevant-library"
```

### Code Analysis
```
# Get code structure
mcp__serena__get_symbols_overview
  relative_path: "src/main.ts"

# Find API patterns
mcp__serena__find_symbol
  name_path_pattern: "API"
```

## Quality Checklist

- [ ] Clear and concise writing
- [ ] Proper markdown formatting
- [ ] Code examples are tested
- [ ] Links are valid
- [ ] Screenshots are current
- [ ] Language: Japanese (unless specified otherwise)

## Output Format

- Format: Markdown
- Language: Japanese (default)
- Headings: Use H1 for title, H2 for sections
- Code blocks: Include language identifier
- Lists: Use for sequential steps or options
