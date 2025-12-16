---
name: code-examples-search
description: Search for code examples, snippets, and library documentation using Context7. Use when user asks for code examples, implementation examples, sample code, or library usage patterns.
---

# Code Examples Search

## Quick Start

Search for library documentation:
```
mcp__context7__resolve-library-id
  libraryName: "react"
```

Get library documentation:
```
mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/facebook/react"
  topic: "hooks"
  mode: "code"
```

## Common Use Cases

- Finding code examples for popular libraries
- Getting API references for frameworks
- Learning library usage patterns
- Finding implementation examples

## Available Tools

### 1. resolve-library-id
Resolves a package/product name to a Context7-compatible library ID.

**When to use:**
- Before calling get-library-docs (unless user provides library ID)
- To find the correct library from a package name

### 2. get-library-docs
Fetches documentation for a library.

**Modes:**
- `code` (default): API references and code examples
- `info`: Conceptual guides and architecture

**Parameters:**
- `context7CompatibleLibraryID`: Library ID from resolve-library-id
- `topic`: Focus area (e.g., "hooks", "routing")
- `mode`: Documentation mode
- `page`: Page number for pagination (1-10)

## Workflow Example

```
# Step 1: Resolve library name to ID
mcp__context7__resolve-library-id
  libraryName: "next.js"

# Step 2: Get documentation
mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/vercel/next.js"
  topic: "routing"
  mode: "code"
```

For detailed API reference, see [REFERENCE.md](REFERENCE.md).
