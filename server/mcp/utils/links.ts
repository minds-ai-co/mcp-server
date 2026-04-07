/**
 * Platform link helpers for MCP tool text responses.
 * Non-widget clients (Langdock, Windsurf, etc.) get clickable links
 * so users can open results in the Minds AI webapp.
 */

/** Link to a Mind's detail page (opens slide-in panel in workspace) */
export function mindLink(baseUrl: string, sparkId: string): string {
  return `${baseUrl}/?sparkId=${sparkId}&openPanel=true`
}

/** Link to a chat/panel flow in the workspace */
export function chatLink(baseUrl: string, flowId: string): string {
  return `${baseUrl}/?flowId=${flowId}`
}

/** Link to the workspace (no specific flow) */
export function workspaceLink(baseUrl: string): string {
  return `${baseUrl}/`
}
