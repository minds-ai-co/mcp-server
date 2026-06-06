/**
 * Platform link helpers for MCP tool text responses.
 * Non-widget clients (Langdock, Windsurf, etc.) get clickable links
 * so users can open results in the Minds webapp.
 */

/** Link to a Mind's detail page (opens slide-in panel in workspace) */
export function mindLink(baseUrl: string, sparkId: string): string {
  return `${baseUrl}/?sparkId=${sparkId}&openPanel=true`
}

/** Link to a chat/panel flow in the workspace */
export function chatLink(baseUrl: string, flowId: string): string {
  return `${baseUrl}/?flowId=${flowId}`
}

/** Public link to a shared panel for customer/respondent access */
export function sharedPanelLink(baseUrl: string, shareId: string): string {
  return `${baseUrl}/panels/shared/${shareId}`
}

/** Public link to a shared group for customer/respondent access */
export function sharedGroupLink(baseUrl: string, shareId: string): string {
  return `${baseUrl}/groups/shared/${shareId}`
}

/** Link to the workspace (no specific flow) */
export function workspaceLink(baseUrl: string): string {
  return `${baseUrl}/`
}
