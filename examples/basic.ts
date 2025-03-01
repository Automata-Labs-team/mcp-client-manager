/**
 * Basic example of using the MCP Client Manager
 * 
 * This example demonstrates how to:
 * 1. Create a manager instance
 * 2. Connect to a server
 * 3. List available tools
 * 4. Call a tool
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPClientManager, ClientTransport } from '../src/index';


// Create a manager with auto-reconnect enabled
const manager = new MCPClientManager({
  autoReconnect: true,
  defaultTimeout: 10000,
  debug: true
});

// Register event handlers
manager.on('serverAdded', ({ clientId, serverName }) => {
  console.log(`Server added: ${serverName} (ID: ${clientId})`);
});

manager.on('connectionError', ({ serverName, error }) => {
  console.error(`Failed to connect to ${serverName}:`, error);
});

manager.on('transportClosed', ({ clientId, serverName }) => {
  console.warn(`Connection to ${serverName} closed`);
});

manager.on('operationError', ({ operation, clientId, serverName, error }) => {
  console.error(`Error during ${operation} on ${serverName}:`, error);
});

async function main() {
  try {
    // Create a transport using StdioClientTransport to a sample MCP server
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"]
    });

    // Create another transport using StdioClientTransport to a sample MCP server
    const transport2 = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    });

    // Connect to the server
    const clientId = await manager.addServer(transport, 'sample server');
    const clientId2 = await manager.addServer(transport2, 'sample-server-filesystem');
    console.log(`Connected to server with client ID: ${clientId}`);
    console.log(`Connected to server with client ID: ${clientId2}`);

    // List server names
    const serverNames = manager.listServerNames();
    console.log('Connected servers:', serverNames);

    // List available tools
    console.log('Listing available tools...');
    const tools = await manager.listTools();
    console.log('Available tools:', tools);

    // Check if a specific tool exists
    if (tools.some((tool: any) => tool.name === 'echo')) {
      console.log('Echo tool found, calling it...');
      const result = await manager.callTool('echo', { message: 'Hello from MCP Client Manager!' });
      console.log('Echo tool result:', result);
    } else {
      console.log('Echo tool not found');
    }

    // List prompts
    try {
      console.log('Listing available prompts...');
      const prompts = await manager.listPrompts();
      console.log('Available prompts:', prompts);
    } catch (error) {
      console.error('Error listing prompts:', error);
    }

    // List resources
    try {
      console.log('Listing available resources...');
      const resources = await manager.listResources();
      console.log('Available resources:', resources);
    } catch (error) {
      console.error('Error listing resources:', error);
    }

    // Disconnect
    console.log('Disconnecting...');
    manager.removeClient(clientId);
    
    console.log('Example completed successfully');
  } catch (error) {
    console.error('Error in example:', error);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 