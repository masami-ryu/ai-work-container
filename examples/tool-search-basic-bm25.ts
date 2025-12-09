#!/usr/bin/env node
/**
 * Tool Search Tool - BM25 Variant Example
 *
 * This example demonstrates how to use the Tool Search Tool with BM25 semantic search
 * to dynamically discover and load tools on-demand using natural language queries.
 *
 * WARNING: Beta specification as of 2025-12-09
 * Verify tool type names and beta headers are correct before execution.
 * See: docs/beta-spec-verification.md
 *
 * Requirements:
 * - @anthropic-ai/sdk >= 0.67.0
 * - Node.js >= 22.0.0
 * - ANTHROPIC_API_KEY environment variable
 * - Claude Opus 4.5 or Claude Sonnet 4.5
 */

import Anthropic from "@anthropic-ai/sdk";

interface ToolDefinition {
  type?: string;
  name: string;
  description?: string;
  input_schema?: any;
  defer_loading?: boolean;
}

/**
 * Create a list of tools with Tool Search Tool (BM25 variant).
 *
 * @returns Array of tool definitions with defer_loading configuration.
 */
function createToolsWithBM25Search(): ToolDefinition[] {
  return [
    // Tool Search Tool (BM25 variant) - Always loaded
    {
      type: "tool_search_tool_bm25_20251119",
      name: "tool_search_tool_bm25",
    },
    // Frequently used tools - NOT deferred
    {
      name: "get_user_info",
      description: "Retrieve user information by user ID",
      input_schema: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "The unique identifier for the user",
          },
        },
        required: ["user_id"],
      },
      // Most frequently used - NOT deferred
    },
    {
      name: "search_documents",
      description: "Search documents in the database using keywords",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query string",
          },
          limit: {
            type: "integer",
            description: "Maximum number of results",
            default: 10,
          },
        },
        required: ["query"],
      },
      // Frequently used - NOT deferred
    },
    {
      name: "list_items",
      description: "List all items with optional filtering",
      input_schema: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description: "Filter criteria",
          },
          page: {
            type: "integer",
            description: "Page number",
            default: 1,
          },
        },
        required: [],
      },
      // Frequently used - NOT deferred
    },
    // Less frequently used tools - Deferred loading
    {
      name: "get_weather",
      description: "Get the weather at a specific location",
      input_schema: {
        type: "object",
        properties: {
          location: { type: "string" },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            default: "celsius",
          },
        },
        required: ["location"],
      },
      defer_loading: true,
    },
    {
      name: "send_email",
      description: "Send an email to a recipient",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
      },
      defer_loading: true,
    },
    {
      name: "schedule_meeting",
      description: "Schedule a meeting with participants",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          participants: {
            type: "array",
            items: { type: "string" },
          },
          start_time: { type: "string", description: "ISO 8601 format" },
          duration_minutes: { type: "integer" },
        },
        required: ["title", "participants", "start_time", "duration_minutes"],
      },
      defer_loading: true,
    },
    {
      name: "query_database",
      description: "Execute a database query",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query" },
          parameters: {
            type: "array",
            items: { type: "string" },
            description: "Query parameters",
          },
        },
        required: ["query"],
      },
      defer_loading: true,
    },
    {
      name: "upload_file",
      description: "Upload a file to storage",
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Local file path" },
          destination: { type: "string", description: "Destination path" },
        },
        required: ["file_path", "destination"],
      },
      defer_loading: true,
    },
    {
      name: "create_ticket",
      description: "Create a support ticket",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Ticket title" },
          description: { type: "string", description: "Ticket description" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Ticket priority",
          },
        },
        required: ["title", "description", "priority"],
      },
      defer_loading: true,
    },
    {
      name: "generate_report",
      description: "Generate a report based on specified parameters",
      input_schema: {
        type: "object",
        properties: {
          report_type: { type: "string", description: "Type of report" },
          parameters: { type: "object", description: "Report parameters" },
        },
        required: ["report_type", "parameters"],
      },
      defer_loading: true,
    },
  ];
}

/**
 * Main execution function
 */
async function main(): Promise<number> {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable not set.");
    console.error("Set it with: export ANTHROPIC_API_KEY=your_api_key_here");
    return 1;
  }

  // Initialize client
  let client: Anthropic;
  try {
    client = new Anthropic({ apiKey });
    console.log("✓ Anthropic client initialized");
  } catch (error) {
    console.error(`Error initializing client: ${error}`);
    return 1;
  }

  // Create tools
  const tools = createToolsWithBM25Search();
  console.log(`✓ Created ${tools.length} tool definitions`);
  console.log(`  - 1 Tool Search Tool (BM25)`);
  console.log(`  - 3 frequently used tools (NOT deferred)`);
  console.log(`  - ${tools.length - 4} less frequent tools (deferred)\n`);

  // Example query
  const userQuery = "I need to check the weather forecast for Tokyo";
  console.log(`User query: ${userQuery}\n`);

  try {
    // Make API request
    console.log("Sending request to Claude API...");
    const response = await client.beta.messages.create({
      model: "claude-sonnet-4-5-20250929",
      betas: ["advanced-tool-use-2025-11-20"],
      max_tokens: 2048,
      tools: tools as any[],
      messages: [
        {
          role: "user",
          content: userQuery,
        },
      ],
    });

    console.log(`✓ Received response (stop_reason: ${response.stop_reason})\n`);

    // Display response content
    console.log("=== Response Content ===");
    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`[Text] ${block.text}`);
      } else if (block.type === "server_tool_use") {
        console.log(`[Server Tool Use] ${(block as any).name}`);
        console.log(`  Input: ${JSON.stringify((block as any).input, null, 2)}`);
      } else if (block.type === "tool_search_tool_result") {
        console.log(`[Tool Search Result]`);
        console.log(`  Tool use ID: ${(block as any).tool_use_id}`);
        console.log(`  References: ${JSON.stringify((block as any).content, null, 2)}`);
      } else if (block.type === "tool_use") {
        console.log(`[Tool Use] ${(block as any).name}`);
        console.log(`  Input: ${JSON.stringify((block as any).input, null, 2)}`);
      }
    }

    // Display usage statistics
    console.log(`\n=== Usage Statistics ===`);
    console.log(`Input tokens: ${response.usage.input_tokens}`);
    console.log(`Output tokens: ${response.usage.output_tokens}`);
    if ("server_tool_use" in response.usage) {
      console.log(`Server tool use: ${JSON.stringify((response.usage as any).server_tool_use)}`);
    }

    return 0;
  } catch (error: any) {
    if (error instanceof Anthropic.APIError) {
      console.error(`❌ API Error: ${error.message}`);
      console.error(`  Status: ${error.status}`);
      console.error(`  Type: ${error.type}`);
    } else {
      console.error(`❌ Unexpected error: ${error}`);
    }
    return 1;
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((exitCode) => {
    process.exit(exitCode);
  });
}

export { createToolsWithBM25Search };
