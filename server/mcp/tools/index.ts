/**
 * MCP Tools barrel export
 */

export { listSparksTool } from './listSparks'
export { createSparkTool } from './createSpark'
export { chatWithSparkTool } from './chatWithSpark'
export { getSparkStatusTool } from './getSparkStatus'
export { createPanelTool } from './createPanel'
export { askPanelTool } from './askPanel'
export { exportPanelTool } from './exportPanel'
export { listPanelsTool } from './listPanels'
export { getPanelStatusTool } from './getPanelStatus'
export { listGroupsTool } from './listGroups'
export { createGroupTool } from './createGroup'
export { createGroupFromBriefTool } from './createGroupFromBrief'
export { getPanelAnalyticsTool } from './getPanelAnalytics'

/**
 * Alias names registered against the same handlers as their canonical tools.
 * Absorbs LLM tool-name hallucinations (e.g. gpt-4o-mini routing
 * `get_mind_training_status` instead of `get_mind_status`).
 *
 * Keys are aliases, values are canonical tool names. The canonical name
 * MUST exist in the registered tool set — server.ts asserts this.
 */
export const TOOL_ALIASES: Record<string, string> = {
  'get_mind_training_status': 'get_mind_status',
  'get_mind_training_progress': 'get_mind_status',
  'get_panel_results': 'get_panel_status',
  'get_panel_answers': 'get_panel_status',
  'chat_with_spark': 'chat_with_mind',
  'ask_mind': 'chat_with_mind',
  'create_spark': 'create_mind',
  'create_persona': 'create_mind',
  'list_sparks': 'list_minds',
  'list_personas': 'list_minds',
  'query_panel': 'ask_panel',
}
