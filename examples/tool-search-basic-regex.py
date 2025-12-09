#!/usr/bin/env python3
"""
Tool Search Tool - Regex Variant Example

This example demonstrates how to use the Tool Search Tool with regex pattern matching
to dynamically discover and load tools on-demand.

WARNING: Beta specification as of 2025-12-09
Verify tool type names and beta headers are correct before execution.
See: docs/beta-spec-verification.md

Requirements:
- anthropic-sdk-python >= 0.75.0
- Claude API key (set ANTHROPIC_API_KEY environment variable)
- Claude Opus 4.5 or Claude Sonnet 4.5
"""

import os
import sys
from typing import Any, Dict, List

try:
    import anthropic
except ImportError:
    print("Error: anthropic package not found.")
    print("Install with: pip install anthropic>=0.75.0")
    sys.exit(1)


def create_tools_with_regex_search() -> List[Dict[str, Any]]:
    """
    Create a list of tools with Tool Search Tool (regex variant).

    Returns:
        List of tool definitions with defer_loading configuration.
    """
    return [
        # Tool Search Tool (regex variant) - Always loaded
        {
            "type": "tool_search_tool_regex_20251119",
            "name": "tool_search_tool_regex"
        },
        # Frequently used tools - NOT deferred (defer_loading: False or omitted)
        {
            "name": "get_user_info",
            "description": "Retrieve user information by user ID",
            "input_schema": {
                "type": "object",
                "properties": {
                    "user_id": {
                        "type": "string",
                        "description": "The unique identifier for the user"
                    }
                },
                "required": ["user_id"]
            },
            # Most frequently used - NOT deferred
        },
        {
            "name": "search_documents",
            "description": "Search documents in the database using keywords",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query string"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results",
                        "default": 10
                    }
                },
                "required": ["query"]
            },
            # Frequently used - NOT deferred
        },
        {
            "name": "list_items",
            "description": "List all items with optional filtering",
            "input_schema": {
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "description": "Filter criteria"
                    },
                    "page": {
                        "type": "integer",
                        "description": "Page number",
                        "default": 1
                    }
                },
                "required": []
            },
            # Frequently used - NOT deferred
        },
        # Less frequently used tools - Deferred loading
        {
            "name": "get_weather",
            "description": "Get the weather at a specific location",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"},
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "default": "celsius"
                    }
                },
                "required": ["location"]
            },
            "defer_loading": True
        },
        {
            "name": "send_email",
            "description": "Send an email to a recipient",
            "input_schema": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Email body"}
                },
                "required": ["to", "subject", "body"]
            },
            "defer_loading": True
        },
        {
            "name": "schedule_meeting",
            "description": "Schedule a meeting with participants",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "participants": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
                    "start_time": {"type": "string", "description": "ISO 8601 format"},
                    "duration_minutes": {"type": "integer"}
                },
                "required": ["title", "participants", "start_time", "duration_minutes"]
            },
            "defer_loading": True
        },
        {
            "name": "query_database",
            "description": "Execute a database query",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "SQL query"},
                    "parameters": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Query parameters"
                    }
                },
                "required": ["query"]
            },
            "defer_loading": True
        },
        {
            "name": "upload_file",
            "description": "Upload a file to storage",
            "input_schema": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Local file path"},
                    "destination": {"type": "string", "description": "Destination path"}
                },
                "required": ["file_path", "destination"]
            },
            "defer_loading": True
        },
    ]


def main():
    """Run Tool Search Tool example with regex variant."""
    # Check for API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("Set it with: export ANTHROPIC_API_KEY=your_api_key_here")
        sys.exit(1)

    # Initialize client
    try:
        client = anthropic.Anthropic(api_key=api_key)
        print("✓ Anthropic client initialized")
    except Exception as e:
        print(f"Error initializing client: {e}")
        sys.exit(1)

    # Create tools
    tools = create_tools_with_regex_search()
    print(f"✓ Created {len(tools)} tool definitions")
    print(f"  - 1 Tool Search Tool (regex)")
    print(f"  - 3 frequently used tools (NOT deferred)")
    print(f"  - {len(tools) - 4} less frequent tools (deferred)\n")

    # Example query
    user_query = "What's the weather in San Francisco?"
    print(f"User query: {user_query}\n")

    try:
        # Make API request
        print("Sending request to Claude API...")
        response = client.beta.messages.create(
            model="claude-sonnet-4-5-20250929",
            betas=["advanced-tool-use-2025-11-20"],
            max_tokens=2048,
            tools=tools,
            messages=[
                {
                    "role": "user",
                    "content": user_query
                }
            ]
        )

        print(f"✓ Received response (stop_reason: {response.stop_reason})\n")

        # Display response content
        print("=== Response Content ===")
        for block in response.content:
            if block.type == "text":
                print(f"[Text] {block.text}")
            elif block.type == "server_tool_use":
                print(f"[Server Tool Use] {block.name}")
                print(f"  Input: {block.input}")
            elif block.type == "tool_search_tool_result":
                print(f"[Tool Search Result]")
                print(f"  Tool use ID: {block.tool_use_id}")
                print(f"  References: {block.content}")
            elif block.type == "tool_use":
                print(f"[Tool Use] {block.name}")
                print(f"  Input: {block.input}")

        # Display usage statistics
        print(f"\n=== Usage Statistics ===")
        print(f"Input tokens: {response.usage.input_tokens}")
        print(f"Output tokens: {response.usage.output_tokens}")
        if hasattr(response.usage, "server_tool_use"):
            print(f"Server tool use: {response.usage.server_tool_use}")

        return 0

    except anthropic.APIError as e:
        print(f"❌ API Error: {e}")
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
