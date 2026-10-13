import type { CallToolResult } from '@modelcontextprotocol/server';

/** A tool result carrying the same data as structured content and as JSON text (for clients that only read text). */
export function json(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** An error Claude should read and react to (wrong input, nothing found), not a protocol failure. */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
