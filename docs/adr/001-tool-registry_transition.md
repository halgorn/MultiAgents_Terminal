# ADR 001: Transition to a Federated Tool Registry

## Status
Accepted — Implemented in commit `cd47af5` (2026-06-13)

## Context
The current implementation of tools in `src/mcp/server.ts` follows a "Gatekeeper" pattern where all tool definitions and logic mappings are hard-coded into the MCP server's startup sequence. This creates several architectural limitations:
1.  **Scalability:** Every new functionality requires modification of the core gateway file.
2.  **Modularity:** Tool implementation is coupled to the transport layer (MCP).
3.  **Governance:** There is no central manifest to define tool schemas or versioning.

## Decision
We will move towards a **Federated Tool Registry**. Instead of a hard-coded list in `src/mcp/server.ts`, we will implement a registry where tools are defined as independent modules that register themselves with the system.

### Requirements:
1.  Every tool must adhere to a standard **ToolContract** (Validation, Schema definitions).
2.  The `mcpservers` should simply iterate over registered tools to build the `ListToolsRequestSchema`.
3.  A `ToolManifest` must be created to serve as the source of truth for internal system audits.

## Alternatives Considered
- **Dynamic Discovery:** Automatically scanning a directory for tool files (Pros: Easy discovery; Cons: Harder to debug/trace).
- **Plugin System:** Loading tools from external packages (Pros: High decoupling; Cons: Complex dependency management).

*Decision Choice:* We will start with a local registry where features are defined in their own modules and registered into a central list at boot time. This provides the best balance of developer experience and architectural integrity.

## Consequences
- **Positive:** Adding a new tool no longer requires touching core networking/gateway code.
-   **Positive:** Clearer separation between "Tool Logic" and "Transport logic".
-   **Negative:** Requires a one-time refactoring of existing tools into the registry format.
-   **Requirement**: Implementation of `ToolManifest` to support governance.

## Rollback Plan
Revert the update to the `mcp/server.ts` file and revert tool definitions to their original location in the hardcoded list.
