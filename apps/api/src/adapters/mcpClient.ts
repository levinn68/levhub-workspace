import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export { Client, SSEClientTransport, StreamableHTTPClientTransport };

export type McpClient = Client;
export type McpTransport = SSEClientTransport | StreamableHTTPClientTransport;
