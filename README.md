# MCP Client Manager

A client manager for the [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/specification) that provides a simple way to manage multiple MCP clients connected to different servers.

[![npm version](https://img.shields.io/npm/v/@modelcontextprotocol/client-manager.svg)](https://www.npmjs.com/package/@modelcontextprotocol/client-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Multiple Server Management**: Connect to multiple MCP servers and manage them through a single interface
- **Server Discovery**: Automatically find which server provides the resources or tools you need
- **Error Handling**: Robust error handling with detailed error information
- **Reconnection Support**: Automatic reconnection capabilities for transient failures
- **Event System**: Event-based architecture for monitoring connections and operations
- **Typed API**: Fully TypeScript-compatible with comprehensive type definitions

## Installation

```bash
npm install @modelcontextprotocol/client-manager
```

## Basic Usage

```typescript
import { MCPClientManager } from '@modelcontextprotocol/client-manager';
import { WebSocketTransport } from '@modelcontextprotocol/sdk/client/websocket.js';

// Create a manager with auto-reconnect enabled
const manager = new MCPClientManager({
  autoReconnect: true,
  defaultTimeout: 10000
});

// Connect to a server
const transport = new WebSocketTransport('ws://localhost:3000');
const clientId = await manager.addServer(transport, 'local-server');

// List available tools from all connected servers
const tools = await manager.listTools();
console.log('Available tools:', tools);

// Call a tool on any server that provides it
const result = await manager.callTool('my-tool', { param: 'value' });
console.log('Tool result:', result);
```

## Advanced Usage

### Connecting to Multiple Servers

```typescript
// Connect to multiple servers
const server1Id = await manager.addServer(
  new WebSocketTransport('ws://server1:3000'), 
  'server-1'
);

const server2Id = await manager.addServer(
  new WebSocketTransport('ws://server2:3000'), 
  'server-2'
);

// You can work with specific servers using their IDs
const server1Tools = await manager.getClient(server1Id).listTools();

// Or use the unified API to work with all servers
const allTools = await manager.listTools();
```

### Handling Events

```typescript
// Listen for connection errors
manager.on('connectionError', ({ serverName, error }) => {
  console.error(`Failed to connect to ${serverName}:`, error);
});

// Listen for transport closures
manager.on('transportClosed', ({ clientId, serverName }) => {
  console.warn(`Connection to ${serverName} closed`);
});

// Listen for operation errors
manager.on('operationError', ({ operation, clientId, serverName, error }) => {
  console.error(`Error during ${operation} on ${serverName}:`, error);
});
```

## Configuration Options

The MCPClientManager constructor accepts a configuration object with these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultTimeout` | number | 30000 | Default timeout in milliseconds for operations |
| `autoReconnect` | boolean | false | Whether to automatically attempt to reconnect disconnected clients |
| `maxReconnectAttempts` | number | 3 | Maximum number of reconnection attempts |
| `reconnectDelay` | number | 5000 | Delay between reconnection attempts in milliseconds |
| `debug` | boolean | false | Whether to emit verbose debug logs |

## API Reference

### Class: MCPClientManager

#### Constructor

```typescript
constructor(config: Partial<MCPClientManagerConfig> = {})
```

Creates a new MCPClientManager instance with the given configuration.

#### Server Management Methods

- `async addServer(transport: ClientTransport, serverName: string, clientConfig?: Partial<ClientConfig>): Promise<ClientIdentifier>`
- `async reconnectClient(clientId: ClientIdentifier): Promise<boolean>`
- `removeClient(id: ClientIdentifier): boolean`
- `isClientHealthy(clientId: ClientIdentifier): boolean`
- `listServerNames(): string[]`
- `hasServer(serverName: string): boolean`
- `getClientInfo(id: ClientIdentifier): Omit<ClientInfo, 'client'> | undefined`
- `getClientIdByServerName(serverName: string): ClientIdentifier | undefined`
- `listClientIds(): ClientIdentifier[]`

#### MCP Operation Methods

- `async listPrompts(timeout?: number): Promise<unknown[]>`
- `async getPrompt(promptName: string, args?: PromptParams, timeout?: number): Promise<unknown>`
- `async listResources(timeout?: number): Promise<unknown[]>`
- `async readResource(resourceUri: string, timeout?: number): Promise<unknown>`
- `async listTools(timeout?: number): Promise<unknown[]>`
- `async callTool(toolName: string, args?: Record<string, unknown>, timeout?: number): Promise<ToolResponse>`

#### Events

- `serverAdded`: Emitted when a server is successfully added
- `connectionError`: Emitted when there's an error connecting to a server
- `transportError`: Emitted when there's an error with a transport
- `transportClosed`: Emitted when a transport is closed
- `clientReconnected`: Emitted when a client is successfully reconnected
- `reconnectionError`: Emitted when there's an error reconnecting a client
- `closeError`: Emitted when there's an error closing a transport
- `clientRemoved`: Emitted when a client is removed
- `operationError`: Emitted when there's an error during an operation

## License

MIT
