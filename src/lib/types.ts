import { Client } from "@modelcontextprotocol/sdk/client/index";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport";

/**
 * Unique identifier for a client
 */
export type ClientIdentifier = string;

/**
 * Re-export the Transport type from the SDK
 */
export { Transport };

export * from "@modelcontextprotocol/sdk/types";

/**
 * Client transport interface that extends SDK Transport
 * with additional event handlers that are useful for our client manager
 */
export interface ClientTransport extends Transport {
  // Additional handlers we might use in our manager
  // (Transport already has onclose, but it's optional)
  onerror?: (error: Error) => void;
}

/**
 * Parameters for prompt calls
 */
export interface PromptParams {
  [key: string]: unknown;
  timeout?: number;
}

/**
 * Parameters for tool calls
 */
export interface ToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
  [key: string]: unknown; // Index signature for SDK compatibility
  _meta?: {
    progressToken?: string | number;
    timeout?: number;
    [key: string]: unknown;
  };
}

/**
 * Tool response from an MCP server
 */
export interface ToolResponse {
  result: unknown;
  [key: string]: unknown;
}

/**
 * Resource parameters
 * Uses the same structure as SDK's ReadResourceRequest["params"]
 */
export interface ResourceParams {
  /**
   * URI of the resource to read
   */
  uri: string;
  
  /**
   * Optional metadata
   */
  _meta?: {
    progressToken?: string | number;
    [key: string]: unknown;
  };
  
  /**
   * Optional timeout in milliseconds
   */
  timeout?: number;
  
  /**
   * Index signature for additional properties
   */
  [key: string]: unknown;
}

/**
 * Client configuration options
 */
export interface ClientConfig {
  capabilities: {
    prompts: Record<string, unknown>;
    resources: Record<string, unknown>;
    tools: Record<string, unknown>;
  };
  [key: string]: unknown;
}

/**
 * Events emitted by the MCPClientManager
 */
export interface MCPClientManagerEvents {
  serverAdded: { clientId: ClientIdentifier; serverName: string };
  connectionError: { serverName: string; error: Error };
  transportError: { clientId: ClientIdentifier; serverName: string; error: Error };
  transportClosed: { clientId: ClientIdentifier; serverName: string };
  clientReconnected: { clientId: ClientIdentifier; serverName: string };
  reconnectionError: { clientId: ClientIdentifier; error: Error };
  closeError: { clientId: ClientIdentifier; error: Error };
  clientRemoved: { clientId: ClientIdentifier; serverName: string };
  operationError: { 
    operation: string; 
    clientId: ClientIdentifier; 
    serverName: string; 
    error: Error 
  };
}

/**
 * Client information object for internal tracking
 */
export interface ClientInfo {
  client: Client;
  serverName: string;
  transport: ClientTransport;
  connected: boolean;
  error?: Error;
}

/**
 * Configuration options for MCPClientManager
 */
export interface MCPClientManagerConfig {
  /**
   * Default timeout in milliseconds for operations
   * @default 30000 (30 seconds)
   */
  defaultTimeout?: number;
  
  /**
   * Whether to automatically attempt to reconnect disconnected clients
   * @default false
   */
  autoReconnect?: boolean;
  
  /**
   * Maximum number of reconnection attempts
   * @default 3
   */
  maxReconnectAttempts?: number;
  
  /**
   * Delay between reconnection attempts in milliseconds
   * @default 5000 (5 seconds)
   */
  reconnectDelay?: number;
  
  /**
   * Whether to emit verbose debug logs
   * @default false
   */
  debug?: boolean;
} 