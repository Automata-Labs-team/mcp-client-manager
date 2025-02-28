/**
 * MCP Client Manager - A client manager for the Model Context Protocol
 * 
 * This package provides a simple way to manage multiple MCP clients connected to different servers.
 * It handles connection management, error handling, and provides a unified API for interacting
 * with MCP servers.
 * 
 * @module @modelcontextprotocol/client-manager
 */

// Re-export the Transport type from the SDK
export { Transport } from "@modelcontextprotocol/sdk/shared/transport";

// Export the main class
export { MCPClientManager } from './lib/MCPClientManager';

// Export types
export * from './lib/types';

// Version information
export const VERSION = '1.0.0'; 