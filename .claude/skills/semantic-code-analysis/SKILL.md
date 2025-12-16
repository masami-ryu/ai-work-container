---
name: semantic-code-analysis
description: Perform semantic code analysis including symbol search, reference finding, code refactoring, and symbol renaming. Use when user asks about symbols, references, code structure, refactoring, or renaming code elements.
---

# Semantic Code Analysis

## Quick Start

### Symbol Search
```
# Get file symbols overview
mcp__serena__get_symbols_overview
  relative_path: "src/app.ts"
  depth: 1

# Find symbol by name
mcp__serena__find_symbol
  name_path_pattern: "MyClass"
  include_body: true
```

### Reference Finding
```
# Find all references to a symbol
mcp__serena__find_referencing_symbols
  name_path: "MyClass/myMethod"
  relative_path: "src/app.ts"
```

### Code Search
```
# Search for pattern in code
mcp__serena__search_for_pattern
  substring_pattern: "TODO.*urgent"
  context_lines_before: 2
  context_lines_after: 2
```

### Symbol Editing
```
# Replace symbol body
mcp__serena__replace_symbol_body
  name_path: "MyClass/myMethod"
  relative_path: "src/app.ts"
  body: "new method implementation"

# Rename symbol
mcp__serena__rename_symbol
  name_path: "oldName"
  relative_path: "src/app.ts"
  new_name: "newName"
```

## Common Use Cases

- Understanding code structure
- Finding symbol definitions and usages
- Refactoring code safely
- Renaming symbols across codebase
- Analyzing code dependencies

## Key Concepts

### Name Paths
A name path identifies a symbol within a file:
- Simple name: `"myFunction"` (matches any symbol with this name)
- Relative path: `"MyClass/myMethod"` (matches method in class)
- Absolute path: `"/MyClass/myMethod"` (exact match from file root)
- Indexed path: `"MyClass/myMethod[0]"` (specific overload)

### Symbol Operations
- **Read**: `get_symbols_overview`, `find_symbol`
- **Search**: `find_referencing_symbols`, `search_for_pattern`
- **Edit**: `replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`
- **Refactor**: `rename_symbol`

For complete API reference with all tools, see [REFERENCE.md](REFERENCE.md).
