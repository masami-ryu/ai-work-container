# Microsoft Documentation Search - API Reference

## Available Tools

### 1. microsoft_docs_search
Search official Microsoft documentation and return up to 10 content chunks.

**Parameters:**
- `query` (required): Search query or topic about Microsoft/Azure products

**Example:**
```
mcp__msdocs__microsoft_docs_search
  query: "ASP.NET Core authentication"
```

**Use cases:**
- Finding official documentation for Microsoft/Azure services
- Getting up-to-date information about Microsoft technologies
- Searching for best practices and tutorials

### 2. microsoft_code_sample_search
Search for code snippets in official Microsoft Learn documentation.

**Parameters:**
- `query` (required): Descriptive query or SDK/method name
- `language` (optional): Programming language (csharp, javascript, python, etc.)

**Example:**
```
mcp__msdocs__microsoft_code_sample_search
  query: "Entity Framework Core"
  language: "csharp"
```

**Supported languages:**
- csharp
- javascript
- typescript
- python
- powershell
- azurecli
- java
- go
- rust
- ruby
- php

**Use cases:**
- Finding code examples for Microsoft SDKs
- Getting implementation examples
- Learning Microsoft API usage patterns

### 3. microsoft_docs_fetch
Fetch and convert a Microsoft Learn documentation page to markdown.

**Parameters:**
- `url` (required): URL of the Microsoft documentation page

**Example:**
```
mcp__msdocs__microsoft_docs_fetch
  url: "https://learn.microsoft.com/azure/azure-functions/functions-reference"
```

**Use cases:**
- Getting complete documentation when search results are incomplete
- Fetching detailed tutorials and step-by-step guides
- Retrieving full troubleshooting documentation

## Search Tips

1. **Use specific keywords**
   - Good: "Azure Functions durable orchestration"
   - Less good: "Azure Functions"

2. **Include product names**
   - Include version if needed (e.g., ".NET 8", "Azure Functions v4")

3. **Use language parameter for code samples**
   - Specify language to get more relevant code examples

4. **Follow-up pattern**
   - Use `microsoft_docs_search` first to find relevant pages
   - Use `microsoft_docs_fetch` to get complete content from high-value pages

## Workflow Example

```
# Step 1: Search for relevant documentation
mcp__msdocs__microsoft_docs_search
  query: "Azure Functions best practices"

# Step 2: Find code examples
mcp__msdocs__microsoft_code_sample_search
  query: "Azure Functions HTTP trigger"
  language: "csharp"

# Step 3: Fetch complete documentation if needed
mcp__msdocs__microsoft_docs_fetch
  url: "https://learn.microsoft.com/azure/azure-functions/functions-best-practices"
```

## Important Notes

- All content comes from Microsoft Learn or official Microsoft sources
- Content is returned in clean markdown format
- Search results include article title, URL, and self-contained excerpt
- Each result is optimized for fast retrieval (max 500 tokens per chunk)
