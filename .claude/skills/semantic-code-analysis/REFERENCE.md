# Semantic Code Analysis - API Reference

## Tool Categories

### File and Directory Operations

#### list_dir
Lists files and directories in a given directory.

**Parameters:**
- `relative_path` (required): Directory path ("." for project root)
- `recursive` (required): Scan subdirectories (boolean)
- `skip_ignored_files`: Skip gitignored files (default: false)
- `max_answer_chars`: Max output size (-1 for default)

#### find_file
Finds files matching a pattern.

**Parameters:**
- `file_mask` (required): Filename or pattern (*, ?)
- `relative_path` (required): Directory to search ("." for root)

### Symbol Reading

#### get_symbols_overview
Get high-level overview of symbols in a file.

**Parameters:**
- `relative_path` (required): File path
- `depth`: Descendant depth (default: 0)
- `max_answer_chars`: Max output size (-1 for default)

**Use cases:**
- First step when understanding a new file
- Getting file structure without reading full content

#### find_symbol
Find symbols by name path pattern.

**Parameters:**
- `name_path_pattern` (required): Symbol name pattern
- `relative_path`: Restrict to file/directory (optional)
- `depth`: Include descendants depth (default: 0)
- `include_body`: Include source code (default: false)
- `substring_matching`: Match partial names (default: false)
- `include_kinds`: LSP symbol kinds to include (array)
- `exclude_kinds`: LSP symbol kinds to exclude (array)

**LSP Symbol Kinds:**
- 1=file, 2=module, 3=namespace, 4=package, 5=class
- 6=method, 7=property, 8=field, 9=constructor, 10=enum
- 11=interface, 12=function, 13=variable, 14=constant
- 15=string, 16=number, 17=boolean, 18=array, 19=object
- 20=key, 21=null, 22=enum member, 23=struct, 24=event
- 25=operator, 26=type parameter

**Examples:**
```
# Find class definition
mcp__serena__find_symbol
  name_path_pattern: "MyClass"
  include_body: true

# Find methods in a class
mcp__serena__find_symbol
  name_path_pattern: "MyClass"
  depth: 1

# Find specific method
mcp__serena__find_symbol
  name_path_pattern: "MyClass/myMethod"
  include_body: true
```

#### find_referencing_symbols
Find all references to a symbol.

**Parameters:**
- `name_path` (required): Symbol name path
- `relative_path` (required): File containing the symbol
- `include_kinds`: Filter by symbol kinds
- `exclude_kinds`: Exclude symbol kinds
- `max_answer_chars`: Max output size

**Returns:**
- Metadata about referencing symbols
- Code snippet around each reference

### Pattern Search

#### search_for_pattern
Search for arbitrary patterns in codebase.

**Parameters:**
- `substring_pattern` (required): Regular expression pattern
- `relative_path`: Restrict to file/directory (default: "")
- `restrict_search_to_code_files`: Only search code files (default: false)
- `paths_include_glob`: Include file pattern (glob)
- `paths_exclude_glob`: Exclude file pattern (glob)
- `context_lines_before`: Lines before match (default: 0)
- `context_lines_after`: Lines after match (default: 0)
- `max_answer_chars`: Max output size

**Pattern Notes:**
- Uses Python regex with DOTALL flag
- `.` matches newlines
- Use non-greedy quantifiers (.*?) to avoid over-matching
- Avoid .* at start/end of pattern

**Examples:**
```
# Find TODO comments
mcp__serena__search_for_pattern
  substring_pattern: "TODO.*"
  context_lines_after: 1

# Find function definitions
mcp__serena__search_for_pattern
  substring_pattern: "function\\s+\\w+"
  restrict_search_to_code_files: true
```

### Symbol Editing

#### replace_symbol_body
Replace the entire body of a symbol.

**Parameters:**
- `name_path` (required): Symbol name path
- `relative_path` (required): File containing symbol
- `body` (required): New symbol body (including signature)

**Important:**
- Body includes signature line for functions
- Does NOT include docstrings or imports

#### insert_after_symbol
Insert content after a symbol.

**Parameters:**
- `name_path` (required): Symbol after which to insert
- `relative_path` (required): File containing symbol
- `body` (required): Content to insert

**Use cases:**
- Adding new methods to a class
- Adding new functions after existing ones

#### insert_before_symbol
Insert content before a symbol.

**Parameters:**
- `name_path` (required): Symbol before which to insert
- `relative_path` (required): File containing symbol
- `body` (required): Content to insert

**Use cases:**
- Adding imports before first symbol
- Adding new class definitions

#### rename_symbol
Rename a symbol throughout the codebase.

**Parameters:**
- `name_path` (required): Symbol to rename
- `relative_path` (required): File containing symbol
- `new_name` (required): New symbol name

**Note:**
- Renames across entire codebase
- For overloaded methods, include signature in name_path

### Memory Operations

#### write_memory
Write information about the project to memory.

**Parameters:**
- `memory_file_name` (required): Memory file name
- `content` (required): Content to write
- `max_answer_chars`: Max output size

#### read_memory
Read project information from memory.

**Parameters:**
- `memory_file_name` (required): Memory file name
- `max_answer_chars`: Max output size

#### list_memories
List available memory files.

#### edit_memory
Edit existing memory file.

**Parameters:**
- `memory_file_name` (required): Memory file name
- `needle` (required): String/pattern to find
- `repl` (required): Replacement string
- `mode` (required): "literal" or "regex"

#### delete_memory
Delete a memory file.

**Parameters:**
- `memory_file_name` (required): Memory file name

### Project Management

#### activate_project
Switch to a different project.

**Parameters:**
- `project` (required): Project name or path

#### get_current_config
Get current agent configuration.

#### check_onboarding_performed
Check if project onboarding was completed.

#### onboarding
Perform project onboarding.

### Analysis Tools

#### think_about_collected_information
Reflect on whether collected information is sufficient.

**When to use:**
- After complex search sequences
- Before making code changes

#### think_about_task_adherence
Verify staying on track with the task.

**When to use:**
- Before inserting/replacing/deleting code
- During long conversations

#### think_about_whether_you_are_done
Check if task is complete.

**When to use:**
- When you think you're done

## Workflow Patterns

### Understanding New Code
```
1. mcp__serena__get_symbols_overview (file structure)
2. mcp__serena__find_symbol (specific symbols)
3. mcp__serena__find_referencing_symbols (usage patterns)
```

### Safe Refactoring
```
1. mcp__serena__find_symbol (find target)
2. mcp__serena__find_referencing_symbols (find all uses)
3. mcp__serena__rename_symbol (rename everywhere)
```

### Targeted Search
```
1. mcp__serena__search_for_pattern (find candidates)
2. mcp__serena__find_symbol (get full symbol info)
3. mcp__serena__replace_symbol_body (make changes)
```

## Best Practices

1. **Progressive Disclosure**: Read overview before details
2. **Targeted Reading**: Only read symbol bodies when needed
3. **Verify Changes**: Use find_referencing_symbols before renaming
4. **Think Tools**: Use thinking tools before major edits
5. **Relative Paths**: Use relative_path to scope searches
