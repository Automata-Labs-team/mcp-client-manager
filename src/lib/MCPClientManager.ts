import { Client } from "@modelcontextprotocol/sdk/client/index";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import { EventEmitter } from "events";
import { 
  ClientIdentifier, 
  ClientInfo, 
  ClientTransport, 
  MCPClientManagerConfig,
  PromptParams,
  ToolCallParams,
  ClientConfig,
  ToolResponse
} from "./types";
import Debug from "debug";

/**
 * Default client configuration options
 */
const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  capabilities: {
    prompts: {},
    resources: {},
    tools: {}
  }
};

/**
 * Default manager configuration
 */
const DEFAULT_MANAGER_CONFIG: MCPClientManagerConfig = {
  defaultTimeout: 30000,
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelay: 5000,
  debug: false
};

/**
 * Manager for handling multiple MCP clients connected to different servers.
 * Provides a unified API for interacting with MCP servers.
 * 
 * @example
 * ```typescript
 * import { MCPClientManager } from '@modelcontextprotocol/client-manager';
 * import { WebSocketTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
 * 
 * const manager = new MCPClientManager();
 * const transport = new WebSocketTransport('ws://localhost:3000');
 * const clientId = await manager.addServer(transport, 'local-server');
 * 
 * const tools = await manager.listTools();
 * const result = await manager.callTool('my-tool', { param: 'value' });
 * ```
 */
export class MCPClientManager extends EventEmitter {
  private clients: Map<ClientIdentifier, ClientInfo> = new Map();
  private serverNames: Set<string> = new Set();
  private nextClientId: number = 1;
  private config: MCPClientManagerConfig;
  private logger: Debug.Debugger;
  private reconnectTimers: Map<ClientIdentifier, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Creates a new MCPClientManager instance
   * @param config Configuration options for the manager
   */
  constructor(config: Partial<MCPClientManagerConfig> = {}) {
    super();
    
    // Merge default config with provided config
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    
    // Initialize the debug logger
    this.logger = Debug('mcp:client-manager');
    
    if (this.config.debug) {
      Debug.enable('mcp:client-manager');
    }
    
    this.logger('Initialized MCPClientManager with config: %O', this.config);
  }

  /**
   * Adds a server by creating a client with the given transport
   * @param transport The transport to connect to the server
   * @param serverName Required name for the server (must be unique)
   * @param clientConfig Optional client configuration to override defaults
   * @returns Promise resolving to the ID of the newly created client
   * @throws Error if a server with the same name already exists
   */
  async addServer(
    transport: Transport, 
    serverName: string,
    clientConfig: Partial<ClientConfig> = {}
  ): Promise<ClientIdentifier> {
    this.logger('Adding server: %s', serverName);
    
    // Check if a server with this name already exists
    if (this.serverNames.has(serverName)) {
      const error = new Error(`Server "${serverName}" already exists. Each server must have a unique name.`);
      this.logger('Error adding server: %O', error);
      throw error;
    }
    
    const clientId = `client-${this.nextClientId++}`;
    
    // Create client info with the provided name
    const clientInfo = {
      name: `${serverName}-client`,
      version: "1.0.0"
    };
    
    try {
      this.logger('Creating client for server: %s', serverName);
      
      // Merge default config with provided config
      const mergedConfig = { ...DEFAULT_CLIENT_CONFIG, ...clientConfig };
      
      // Create and connect the client
      const client = new Client(clientInfo, mergedConfig);
      
      // Set up error handling for the transport - cast to ClientTransport to access our extensions
      this.setupTransportErrorHandling(transport as ClientTransport, clientId, serverName);
      
      await client.connect(transport);
      
      this.logger('Client connected to server: %s', serverName);
      
      // Add to our managed clients with connection state info
      this.clients.set(clientId, {
        client,
        serverName,
        transport: transport as ClientTransport,
        connected: true
      });
      
      // Register the server name
      this.serverNames.add(serverName);
      
      this.emit('serverAdded', { clientId, serverName });
      return clientId;
    } catch (error) {
      // Handle connection errors
      const typedError = error instanceof Error ? error : new Error(String(error));
      this.logger('Error connecting to server %s: %O', serverName, typedError);
      this.emit('connectionError', { serverName, error: typedError });
      throw typedError;
    }
  }

  /**
   * Set up error handling for a transport
   * @param transport The transport to monitor
   * @param clientId The ID of the client using this transport
   * @param serverName The name of the server
   */
  private setupTransportErrorHandling(
    transport: ClientTransport, 
    clientId: string, 
    serverName: string
  ): void {
    // Handle transport errors if our transport extension has the onerror handler
    if (transport.onerror === undefined) {
      transport.onerror = (error: Error) => {
        this.logger('Transport error for %s: %O', serverName, error);
        const clientInfo = this.clients.get(clientId);
        if (clientInfo) {
          clientInfo.error = error;
          this.emit('transportError', { clientId, serverName, error });
        }
      };
    }

    // Handle transport closure (part of the standard Transport interface)
    if (transport.onclose === undefined) {
      transport.onclose = () => {
        this.logger('Transport closed for %s', serverName);
        const clientInfo = this.clients.get(clientId);
        if (clientInfo) {
          clientInfo.connected = false;
          this.emit('transportClosed', { clientId, serverName });
          
          // Auto-reconnect if enabled
          if (this.config.autoReconnect) {
            this.scheduleReconnect(clientId);
          }
        }
      };
    }
  }

  /**
   * Schedule a reconnection attempt for a client
   * @param clientId The client ID to reconnect
   * @param attemptCount Current attempt count
   */
  private scheduleReconnect(clientId: ClientIdentifier, attemptCount = 0): void {
    // Clear any existing reconnect timer
    const existingTimer = this.reconnectTimers.get(clientId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Check if we've exceeded max attempts
    if (attemptCount >= (this.config.maxReconnectAttempts || 0)) {
      this.logger('Max reconnect attempts reached for client: %s', clientId);
      return;
    }
    
    this.logger('Scheduling reconnect for client %s (attempt %d)', clientId, attemptCount + 1);
    
    // Schedule reconnect
    const timer = setTimeout(async () => {
      try {
        const success = await this.reconnectClient(clientId);
        if (!success && this.config.autoReconnect) {
          // If reconnect failed, try again
          this.scheduleReconnect(clientId, attemptCount + 1);
        }
      } catch (error) {
        this.logger('Error during scheduled reconnect: %O', error);
        // Try again with incremented attempt count
        this.scheduleReconnect(clientId, attemptCount + 1);
      }
    }, this.config.reconnectDelay);
    
    this.reconnectTimers.set(clientId, timer);
  }

  /**
   * Checks if a client is connected and ready
   * @param clientId The client ID to check
   * @returns True if the client is connected and has no errors
   */
  isClientHealthy(clientId: ClientIdentifier): boolean {
    const clientInfo = this.clients.get(clientId);
    return !!clientInfo && clientInfo.connected && clientInfo.error === undefined;
  }

  /**
   * Get the list of registered server names
   * @returns Array of server names
   */
  listServerNames(): string[] {
    return Array.from(this.serverNames);
  }

  /**
   * Check if a server with the given name exists
   * @param serverName The server name to check
   * @returns True if a server with this name exists
   */
  hasServer(serverName: string): boolean {
    return this.serverNames.has(serverName);
  }

  /**
   * Gets client info by ID
   * @param id The client identifier
   * @returns The ClientInfo object or undefined if not found
   */
  getClientInfo(id: ClientIdentifier): Omit<ClientInfo, 'client'> | undefined {
    const clientInfo = this.clients.get(id);
    if (!clientInfo) {
      return undefined;
    }
    
    // Return a copy without exposing the client instance directly
    return {
      serverName: clientInfo.serverName,
      transport: clientInfo.transport,
      connected: clientInfo.connected,
      error: clientInfo.error
    };
  }

  /**
   * Gets client by server name
   * @param serverName The server name to find the client for
   * @returns The client ID or undefined if not found
   */
  getClientIdByServerName(serverName: string): ClientIdentifier | undefined {
    for (const [id, info] of this.clients.entries()) {
      if (info.serverName === serverName) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Attempt to reconnect a client
   * @param clientId The client ID to reconnect
   * @returns Promise resolving to true if reconnection was successful
   */
  async reconnectClient(clientId: ClientIdentifier): Promise<boolean> {
    this.logger('Attempting to reconnect client: %s', clientId);
    
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) {
      this.logger('Client not found: %s', clientId);
      return false;
    }
    
    if (clientInfo.connected) {
      this.logger('Client already connected: %s', clientId);
      return true;
    }

    try {
      // Create a new client with the same info
      const client = new Client(
        { name: `${clientInfo.serverName}-client`, version: "1.0.0" }, 
        DEFAULT_CLIENT_CONFIG
      );
      
      // Setup error handling again
      this.setupTransportErrorHandling(clientInfo.transport, clientId, clientInfo.serverName);
      
      // Connect with the existing transport
      await client.connect(clientInfo.transport);
      
      // Update the client info
      clientInfo.client = client;
      clientInfo.connected = true;
      clientInfo.error = undefined;
      
      this.logger('Client reconnected successfully: %s', clientId);
      this.emit('clientReconnected', { clientId, serverName: clientInfo.serverName });
      return true;
    } catch (error) {
      const typedError = error instanceof Error ? error : new Error(String(error));
      this.logger('Reconnection failed for client %s: %O', clientId, typedError);
      this.emit('reconnectionError', { clientId, error: typedError });
      return false;
    }
  }

  /**
   * Removes a client and its associated server name
   * @param id The client identifier
   * @returns True if the client was removed, false if it didn't exist
   */
  removeClient(id: ClientIdentifier): boolean {
    this.logger('Removing client: %s', id);
    
    const clientInfo = this.clients.get(id);
    if (!clientInfo) {
      this.logger('Client not found: %s', id);
      return false;
    }

    // Remove any pending reconnect timers
    const reconnectTimer = this.reconnectTimers.get(id);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(id);
    }

    // Remove the server name from the registry
    this.serverNames.delete(clientInfo.serverName);
    
    // Close the transport if it's connected
    if (clientInfo.connected && clientInfo.transport) {
      try {
        clientInfo.transport.close();
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        this.logger('Error closing transport: %O', typedError);
        this.emit('closeError', { clientId: id, error: typedError });
      }
    }
    
    // Remove the client from the map
    const result = this.clients.delete(id);
    if (result) {
      this.logger('Client removed: %s', id);
      this.emit('clientRemoved', { clientId: id, serverName: clientInfo.serverName });
    }
    
    return result;
  }

  /**
   * Gets a client by ID (for internal use)
   * @param id The client identifier
   * @returns The Client instance or undefined if not found
   * @private
   */
  private getClient(id: ClientIdentifier): Client | undefined {
    const clientInfo = this.clients.get(id);
    return clientInfo ? clientInfo.client : undefined;
  }

  /**
   * Lists all client IDs
   * @returns Array of client identifiers
   */
  listClientIds(): ClientIdentifier[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Aggregates prompts from all clients
   * @param timeout Optional timeout in milliseconds
   * @returns Combined list of prompts
   */
  async listPrompts(timeout?: number): Promise<unknown[]> {
    this.logger('Listing prompts from all clients');
    
    const allPrompts: unknown[] = [];
    const errors: Array<{ clientId: string; error: Error }> = [];
    
    // Use provided timeout or default
    const effectiveTimeout = timeout || this.config.defaultTimeout;
    
    for (const [id, clientInfo] of this.clients.entries()) {
      if (!clientInfo.connected) {
        this.logger('Skipping disconnected client %s', clientInfo.serverName);
        continue; // Skip disconnected clients
      }
      
      try {
        this.logger('Listing prompts from %s', clientInfo.serverName);
        const prompts = await clientInfo.client.listPrompts({ timeout: effectiveTimeout });
        if (Array.isArray(prompts.prompts)) {
          this.logger('Found %d prompts from %s', prompts.prompts.length, clientInfo.serverName);
          allPrompts.push(...prompts.prompts);
        }
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        clientInfo.error = typedError;
        errors.push({ clientId: id, error: typedError });
        this.logger('Error listing prompts from %s: %O', clientInfo.serverName, typedError);
        this.emit('operationError', { 
          operation: 'listPrompts', 
          clientId: id, 
          serverName: clientInfo.serverName, 
          error: typedError 
        });
      }
    }
    
    if (errors.length > 0 && allPrompts.length === 0) {
      throw new AggregateError(
        errors.map(e => e.error), 
        `Failed to list prompts from all clients`
      );
    }
    
    return allPrompts;
  }

  /**
   * Gets a prompt from the first client that has it
   * @param promptName Name of the prompt
   * @param args Arguments for the prompt
   * @param timeout Optional timeout in milliseconds
   * @returns The prompt or throws an error if not found
   */
  async getPrompt(promptName: string, args: PromptParams = {}, timeout?: number): Promise<unknown> {
    this.logger('Getting prompt %s with args %O', promptName, args);
    
    const errors: Array<{ clientId: string; error: Error }> = [];
    
    // Set timeout if provided
    if (timeout) {
      args.timeout = timeout;
    } else if (this.config.defaultTimeout && !args.timeout) {
      args.timeout = this.config.defaultTimeout;
    }
    
    for (const [id, clientInfo] of this.clients.entries()) {
      if (!clientInfo.connected) {
        this.logger('Skipping disconnected client %s', clientInfo.serverName);
        continue; // Skip disconnected clients
      }
      
      try {
        this.logger('Trying to get prompt %s from %s', promptName, clientInfo.serverName);
        // Create a proper request object for getPrompt
        const promptRequest = {
          name: promptName,
          ...args
        };
        
        // Use the client's getPrompt method
        return await clientInfo.client.getPrompt(promptRequest);
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        errors.push({ clientId: id, error: typedError });
        this.logger('Error getting prompt %s from %s: %O', promptName, clientInfo.serverName, typedError);
        this.emit('operationError', { 
          operation: 'getPrompt', 
          clientId: id, 
          serverName: clientInfo.serverName, 
          error: typedError 
        });
        // Continue to the next client if this one doesn't have the prompt
      }
    }
    
    this.logger('Prompt %s not found in any client', promptName);
    throw new AggregateError(
      errors.map(e => e.error), 
      `Prompt "${promptName}" not found in any client`
    );
  }

  /**
   * Aggregates resources from all clients
   * @param timeout Optional timeout in milliseconds
   * @returns Combined list of resources
   */
  async listResources(timeout?: number): Promise<unknown[]> {
    this.logger('Listing resources from all clients');
    
    const allResources: unknown[] = [];
    const errors: Array<{ clientId: string; error: Error }> = [];
    
    // Use provided timeout or default
    const effectiveTimeout = timeout || this.config.defaultTimeout;
    
    for (const [id, clientInfo] of this.clients.entries()) {
      if (!clientInfo.connected) {
        this.logger('Skipping disconnected client %s', clientInfo.serverName);
        continue; // Skip disconnected clients
      }
      
      try {
        this.logger('Listing resources from %s', clientInfo.serverName);
        const resources = await clientInfo.client.listResources({ timeout: effectiveTimeout });
        if (Array.isArray(resources.resources)) {
          this.logger('Found %d resources from %s', resources.resources.length, clientInfo.serverName);
          allResources.push(...resources.resources);
        }
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        clientInfo.error = typedError;
        errors.push({ clientId: id, error: typedError });
        this.logger('Error listing resources from %s: %O', clientInfo.serverName, typedError);
        this.emit('operationError', { 
          operation: 'listResources', 
          clientId: id, 
          serverName: clientInfo.serverName, 
          error: typedError 
        });
      }
    }
    
    if (errors.length > 0 && allResources.length === 0) {
      throw new AggregateError(
        errors.map(e => e.error), 
        `Failed to list resources from all clients`
      );
    }
    
    return allResources;
  }

  /**
   * Reads a resource from the first client that has it
   * @param resourceUri URI of the resource
   * @param timeout Optional timeout in milliseconds
   * @returns The resource or throws an error if not found
   */
  async readResource(resourceUri: string, timeout?: number): Promise<unknown> {
    this.logger('Reading resource %s', resourceUri);
    
    const errors: Array<{ clientId: string; error: Error }> = [];
    const options: Record<string, unknown> = {};
    
    // Set timeout if provided
    if (timeout || this.config.defaultTimeout) {
      options.timeout = timeout || this.config.defaultTimeout;
    }
    
    for (const [id, clientInfo] of this.clients.entries()) {
      if (!clientInfo.connected) {
        this.logger('Skipping disconnected client %s', clientInfo.serverName);
        continue; // Skip disconnected clients
      }
      
      try {
        this.logger('Trying to read resource %s from %s', resourceUri, clientInfo.serverName);
        // Create proper request object for readResource
        const resourceRequest = {
          uri: resourceUri,
          ...options
        };
        
        return await clientInfo.client.readResource(resourceRequest);
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        errors.push({ clientId: id, error: typedError });
        this.logger('Error reading resource %s from %s: %O', resourceUri, clientInfo.serverName, typedError);
        this.emit('operationError', { 
          operation: 'readResource', 
          clientId: id, 
          serverName: clientInfo.serverName, 
          error: typedError 
        });
        // Continue to the next client if this one doesn't have the resource
      }
    }
    
    this.logger('Resource %s not found in any client', resourceUri);
    throw new AggregateError(
      errors.map(e => e.error), 
      `Resource "${resourceUri}" not found in any client`
    );
  }

  /**
   * Aggregates tools from all clients
   * @param timeout Optional timeout in milliseconds
   * @returns Combined list of tools
   */
  async listTools(timeout?: number): Promise<unknown[]> {
    this.logger('Listing tools from all clients');
    
    const allTools: unknown[] = [];
    const errors: Array<{ clientId: string; error: Error }> = [];
    
    // Use provided timeout or default
    const effectiveTimeout = timeout || this.config.defaultTimeout;
    
    for (const [id, clientInfo] of this.clients.entries()) {
      if (!clientInfo.connected) {
        this.logger('Skipping disconnected client %s', clientInfo.serverName);
        continue; // Skip disconnected clients
      }
      
      try {
        this.logger('Listing tools from %s', clientInfo.serverName);
        const tools = await clientInfo.client.listTools({ timeout: effectiveTimeout });
        
        if (tools && Array.isArray(tools.tools)) {
          this.logger('Found %d tools from %s', tools.tools.length, clientInfo.serverName);
          allTools.push(...tools.tools);
        }
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        clientInfo.error = typedError;
        errors.push({ clientId: id, error: typedError });
        this.logger('Error listing tools from %s: %O', clientInfo.serverName, typedError);
        this.emit('operationError', { 
          operation: 'listTools', 
          clientId: id, 
          serverName: clientInfo.serverName, 
          error: typedError 
        });
      }
    }
    
    if (errors.length > 0 && allTools.length === 0) {
      throw new AggregateError(
        errors.map(e => e.error), 
        `Failed to list tools from all clients`
      );
    }
    
    return allTools;
  }

  /**
   * Calls a tool from the first client that has it
   * @param toolName Name of the tool
   * @param args Arguments for the tool
   * @param timeout Optional timeout in milliseconds
   * @returns The tool result or throws an error if not found
   */
  async callTool(toolName: string, args: Record<string, unknown> = {}, timeout?: number): Promise<ToolResponse> {
    this.logger('Calling tool %s with args %O', toolName, args);
    
    const toolRequest: ToolCallParams = {
      name: toolName,
      arguments: args
    };
    
    // Set timeout if provided
    if (timeout || this.config.defaultTimeout) {
      toolRequest._meta = toolRequest._meta || {};
      toolRequest._meta.timeout = timeout || this.config.defaultTimeout;
    }
    
    const errors: Array<{ clientId: string; error: Error }> = [];
    
    for (const [id, clientInfo] of this.clients.entries()) {
      if (!clientInfo.connected) {
        this.logger('Skipping disconnected client %s', clientInfo.serverName);
        continue; // Skip disconnected clients
      }
      
      try {
        this.logger('Trying to call tool %s on %s', toolName, clientInfo.serverName);
        // The SDK will return a properly shaped result
        const result = await clientInfo.client.callTool(toolRequest);
        
        // Convert to our ToolResponse type
        return { 
          result: result.result,
          ...result 
        } as ToolResponse;
      } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        errors.push({ clientId: id, error: typedError });
        this.logger('Error calling tool %s on %s: %O', toolName, clientInfo.serverName, typedError);
        this.emit('operationError', { 
          operation: 'callTool', 
          clientId: id, 
          serverName: clientInfo.serverName, 
          error: typedError 
        });
        // Continue to the next client if this one doesn't have the tool
      }
    }
    
    this.logger('Tool %s not found in any client', toolName);
    throw new AggregateError(
      errors.map(e => e.error), 
      `Tool "${toolName}" not found in any client`
    );
  }

  /**
   * Gets tools from a specific client
   * @param clientId The client identifier
   * @param timeout Optional timeout in milliseconds
   * @returns List of tools from the specified client
   * @throws Error if the client isn't found or connected
   */
  async getClientTools(clientId: ClientIdentifier, timeout?: number): Promise<unknown[]> {
    this.logger('Getting tools from client %s', clientId);
    
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) {
      const error = new Error(`Client with ID "${clientId}" not found`);
      this.logger('Error: %O', error);
      throw error;
    }
    
    if (!clientInfo.connected) {
      const error = new Error(`Client with ID "${clientId}" is not connected`);
      this.logger('Error: %O', error);
      throw error;
    }
    
    try {
      // Use provided timeout or default
      const effectiveTimeout = timeout || this.config.defaultTimeout;
      this.logger('Listing tools from %s', clientInfo.serverName);
      
      const tools = await clientInfo.client.listTools({ timeout: effectiveTimeout });
      
      if (tools && Array.isArray(tools.tools)) {
        this.logger('Found %d tools from %s', tools.tools.length, clientInfo.serverName);
        return tools.tools;
      }
      
      return [];
    } catch (error) {
      const typedError = error instanceof Error ? error : new Error(String(error));
      clientInfo.error = typedError;
      this.logger('Error listing tools from %s: %O', clientInfo.serverName, typedError);
      this.emit('operationError', { 
        operation: 'getClientTools', 
        clientId, 
        serverName: clientInfo.serverName, 
        error: typedError 
      });
      throw typedError;
    }
  }
  
  /**
   * Gets resources from a specific client
   * @param clientId The client identifier
   * @param timeout Optional timeout in milliseconds
   * @returns List of resources from the specified client
   * @throws Error if the client isn't found or connected
   */
  async getClientResources(clientId: ClientIdentifier, timeout?: number): Promise<unknown[]> {
    this.logger('Getting resources from client %s', clientId);
    
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) {
      const error = new Error(`Client with ID "${clientId}" not found`);
      this.logger('Error: %O', error);
      throw error;
    }
    
    if (!clientInfo.connected) {
      const error = new Error(`Client with ID "${clientId}" is not connected`);
      this.logger('Error: %O', error);
      throw error;
    }
    
    try {
      // Use provided timeout or default
      const effectiveTimeout = timeout || this.config.defaultTimeout;
      this.logger('Listing resources from %s', clientInfo.serverName);
      
      const resources = await clientInfo.client.listResources({ timeout: effectiveTimeout });
      if (Array.isArray(resources.resources)) {
        this.logger('Found %d resources from %s', resources.resources.length, clientInfo.serverName);
        return resources.resources;
      }
      
      return [];
    } catch (error) {
      const typedError = error instanceof Error ? error : new Error(String(error));
      clientInfo.error = typedError;
      this.logger('Error listing resources from %s: %O', clientInfo.serverName, typedError);
      this.emit('operationError', { 
        operation: 'getClientResources', 
        clientId, 
        serverName: clientInfo.serverName, 
        error: typedError 
      });
      throw typedError;
    }
  }
  
  /**
   * Gets prompts from a specific client
   * @param clientId The client identifier
   * @param timeout Optional timeout in milliseconds
   * @returns List of prompts from the specified client
   * @throws Error if the client isn't found or connected
   */
  async getClientPrompts(clientId: ClientIdentifier, timeout?: number): Promise<unknown[]> {
    this.logger('Getting prompts from client %s', clientId);
    
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) {
      const error = new Error(`Client with ID "${clientId}" not found`);
      this.logger('Error: %O', error);
      throw error;
    }
    
    if (!clientInfo.connected) {
      const error = new Error(`Client with ID "${clientId}" is not connected`);
      this.logger('Error: %O', error);
      throw error;
    }
    
    try {
      // Use provided timeout or default
      const effectiveTimeout = timeout || this.config.defaultTimeout;
      this.logger('Listing prompts from %s', clientInfo.serverName);
      
      const prompts = await clientInfo.client.listPrompts({ timeout: effectiveTimeout });
      if (Array.isArray(prompts.prompts)) {
        this.logger('Found %d prompts from %s', prompts.prompts.length, clientInfo.serverName);
        return prompts.prompts;
      }
      
      return [];
    } catch (error) {
      const typedError = error instanceof Error ? error : new Error(String(error));
      clientInfo.error = typedError;
      this.logger('Error listing prompts from %s: %O', clientInfo.serverName, typedError);
      this.emit('operationError', { 
        operation: 'getClientPrompts', 
        clientId, 
        serverName: clientInfo.serverName, 
        error: typedError 
      });
      throw typedError;
    }
  }
} 