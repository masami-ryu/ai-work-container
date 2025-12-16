# Code Examples Search - API Reference

## Available Tools

### 1. resolve-library-id
Resolves a package/product name to a Context7-compatible library ID.

**Parameters:**
- `libraryName` (required): Library name to search for (e.g., "react", "next.js", "mongodb")

**Example:**
```
mcp__context7__resolve-library-id
  libraryName: "react"
```

**Returns:**
- Context7-compatible library ID (e.g., "/facebook/react")
- List of matching libraries if multiple matches exist
- Information about benchmark score, documentation coverage, and source reputation

**Use cases:**
- Finding the correct library ID before fetching documentation
- Verifying library availability in Context7
- Discovering alternative libraries with similar names

**Important:**
- You MUST call this function before `get-library-docs` unless the user explicitly provides a library ID in the format `/org/project` or `/org/project/version`
- Returns the most relevant match based on name similarity, description relevance, and documentation coverage

### 2. get-library-docs
Fetches up-to-date documentation for a library.

**Parameters:**
- `context7CompatibleLibraryID` (required): Library ID from resolve-library-id (e.g., "/mongodb/docs", "/vercel/next.js")
- `topic` (optional): Topic to focus documentation on (e.g., "hooks", "routing", "authentication")
- `mode` (optional): Documentation mode, default is "code"
  - `code`: API references and code examples (default)
  - `info`: Conceptual guides, narrative information, and architectural questions
- `page` (optional): Page number for pagination (1-10, default: 1)

**Example:**
```
mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/vercel/next.js"
  topic: "routing"
  mode: "code"
```

**Use cases:**
- Getting API references and code examples
- Finding implementation patterns for specific features
- Learning library usage through examples
- Discovering best practices from official documentation

**Pagination:**
- If context is not sufficient, try page=2, page=3, etc. with the same topic
- Maximum page number is 10

## Selection Process

When using `resolve-library-id`, the tool selects the most relevant library based on:
1. **Name similarity**: Exact matches are prioritized
2. **Description relevance**: How well the library matches the query's intent
3. **Documentation coverage**: Libraries with higher code snippet counts are prioritized
4. **Source reputation**: Libraries with High or Medium reputation are more authoritative
5. **Benchmark Score**: Quality indicator (100 is the highest score)

## Workflow Example

```
# Step 1: Resolve library name to ID
mcp__context7__resolve-library-id
  libraryName: "next.js"

# Response: Library ID is "/vercel/next.js"

# Step 2: Get code examples for routing
mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/vercel/next.js"
  topic: "routing"
  mode: "code"

# Step 3: If more information is needed, get conceptual guide
mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/vercel/next.js"
  topic: "routing"
  mode: "info"

# Step 4: If context is not sufficient, try next page
mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/vercel/next.js"
  topic: "routing"
  mode: "code"
  page: 2
```

## Search Tips

1. **Use specific library names**
   - Good: "react", "next.js", "mongodb"
   - Less good: "javascript framework", "database"

2. **Focus topics for better results**
   - Specify what you're looking for (e.g., "hooks", "authentication", "deployment")
   - Without topic, you get general documentation

3. **Choose the right mode**
   - Use `code` mode (default) for API references and implementation examples
   - Use `info` mode for architectural concepts and design patterns

4. **Paginate when needed**
   - First page usually contains the most relevant information
   - Use pagination if you need more examples or details

5. **Handle ambiguous queries**
   - If multiple libraries match, the tool will suggest alternatives
   - Request clarification from the user if needed

## Common Use Cases

### Finding API Documentation
```
mcp__context7__resolve-library-id
  libraryName: "express"

mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/expressjs/express"
  topic: "middleware"
  mode: "code"
```

### Learning Framework Patterns
```
mcp__context7__resolve-library-id
  libraryName: "vue"

mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/vuejs/core"
  topic: "composition api"
  mode: "info"
```

### Getting Implementation Examples
```
mcp__context7__resolve-library-id
  libraryName: "prisma"

mcp__context7__get-library-docs
  context7CompatibleLibraryID: "/prisma/prisma"
  topic: "queries"
  mode: "code"
```

## Important Notes

- Always call `resolve-library-id` first unless you have a specific library ID
- Library IDs are in the format `/org/project` or `/org/project/version`
- Content is returned from official library documentation and repositories
- Documentation is optimized for code generation and understanding
- If a library is not found, the tool will suggest similar alternatives
- For version-specific documentation, include version in the library ID (e.g., "/vercel/next.js/v14.3.0-canary.87")
