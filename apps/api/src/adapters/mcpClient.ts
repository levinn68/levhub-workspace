/**
 * Single import surface for the official MCP client.
 *
 * IMPORTANT: `@modelcontextprotocol/client` exposes everything from its root
 * entry point. There are no `./client/*` subpaths — earlier commits in this
 * branch wrongly used `@modelcontextprotocol/sdk/client/*.js`, which is what
 * failed CI with TS2307 "Cannot find module".
 */
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

export { Client, SSEClientTransport, StreamableHTTPClientTransport };

export type McpClient = Client;
export type McpTransport = SSEClientTransport | StreamableHTTPClientTransport;
