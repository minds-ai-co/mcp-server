/**
 * MCP client identification heuristics.
 *
 * The MCP spec gives us a JSON-RPC `clientInfo.name` on the `initialize` call,
 * but server-side MCP runners (OpenAI's Responses API, OpenRouter's pass-through,
 * Open WebUI in Native function-calling mode) all show up as a generic HTTP
 * client (typically `python-httpx/*` from an Azure IP) by the time the call
 * reaches us — without enough metadata to disambiguate from a custom script.
 *
 * We use User-Agent as the primary signal because it's the only thing the
 * model-provider's MCP runner reliably sets, and we tailor the 401 body to
 * give that caller the exact fix instead of a generic "auth required".
 *
 * NOTE: this is purely cosmetic — every code path still falls through to the
 * same 401 + RFC 9728 challenge. We just upgrade the human-readable hint.
 */

export type McpCallerHint =
  | 'openai-responses-api'
  | 'anthropic-mcp'
  | 'mcp-remote'
  | 'mcp-inspector'
  | 'openwebui'
  | 'librechat'
  | 'curl'
  | 'browser'
  | 'unknown'

/**
 * Identify the caller from the User-Agent header.
 *
 * `python-httpx/*` is treated as `openai-responses-api` because that is the
 * UA OpenAI's server-side MCP fetcher uses (verified via prod audit logs from
 * 20.73.180.17 = Microsoft Azure / OpenAI infra). It's also the same UA that
 * OpenRouter uses when proxying to OpenAI Responses API, since OpenAI does
 * the actual HTTP fetch.
 */
export function classifyMcpCaller(userAgent: string | undefined): McpCallerHint {
  const ua = (userAgent || '').toLowerCase()
  if (!ua) return 'unknown'

  // Python httpx — OpenAI's server-side MCP runner (Responses API + OpenRouter
  // pass-through). Most common hit for the OAuth-vs-Bearer footgun.
  if (ua.includes('python-httpx')) return 'openai-responses-api'

  // Anthropic Claude does the full RFC 9728 + DCR + PKCE dance. Worth
  // distinguishing because if Claude lands on our 401, the user genuinely
  // needs to re-authorize (their token expired) — not switch auth modes.
  if (ua.includes('claude') || ua.includes('anthropic')) return 'anthropic-mcp'

  // mcp-remote (npm package, used by Claude Desktop's local connector mode)
  if (ua.includes('mcp-remote')) return 'mcp-remote'

  // MCP Inspector / SDK developer tooling
  if (ua.includes('mcp-inspector') || ua.includes('modelcontextprotocol')) return 'mcp-inspector'

  // Open WebUI's own bridge UA (when OWUI itself is the HTTP client, e.g.
  // Default function-calling mode).
  if (ua.includes('open-webui') || ua.includes('openwebui')) return 'openwebui'

  if (ua.includes('librechat')) return 'librechat'
  if (ua.startsWith('curl/')) return 'curl'
  if (ua.includes('mozilla/') || ua.includes('chrome/') || ua.includes('safari/')) return 'browser'

  return 'unknown'
}

/**
 * Generate a locale-tagged 401 message body that matches the caller's
 * situation. We accept both the UA classification and an optional
 * `Accept-Language` header so docs links resolve to the right localized
 * page.
 *
 * The result is the `error.message` string for JSON-RPC. `data` (with
 * machine-readable hints + URLs) is built separately by the caller.
 */
export function buildAuthRequiredMessage(
  hint: McpCallerHint,
  publicBaseUrl: string,
  acceptLanguage?: string
): string {
  const lang = pickSupportedLang(acceptLanguage)
  const t = AUTH_REQUIRED_MESSAGES[lang]

  // Default: same as before — covers anthropic-mcp, mcp-remote, mcp-inspector,
  // openwebui, librechat, curl, browser, unknown.
  let core = t.generic

  if (hint === 'openai-responses-api') {
    core = t.openaiResponses
  } else if (hint === 'anthropic-mcp') {
    core = t.anthropic
  }

  const docsPath = lang === 'en' ? '/mcp/setup' : `/${lang}/mcp/setup`
  const docs = `${publicBaseUrl}${docsPath}#${t.anchor}`
  return `${core} ${t.docsHint} ${docs}`
}

/**
 * Build the structured `data` block for the JSON-RPC error so model-side
 * tool error renderers can surface the hint without re-parsing the message.
 */
export function buildAuthRequiredData(
  hint: McpCallerHint,
  publicBaseUrl: string
): Record<string, unknown> {
  const apiKeysUrl = `${publicBaseUrl}/settings/api-keys`
  const docsUrl = `${publicBaseUrl}/mcp/setup`
  return {
    type: 'AUTHENTICATION_REQUIRED',
    callerHint: hint,
    apiKeyUrl: apiKeysUrl,
    docsUrl,
    instructions:
      hint === 'openai-responses-api'
        ? `Server-side MCP runners (OpenAI Responses API, OpenRouter pass-through, Open WebUI Native mode) cannot perform the OAuth handshake. Generate an API key at ${apiKeysUrl} and pass it as a static "Authorization: Bearer minds_..." header on the MCP tool descriptor.`
        : hint === 'anthropic-mcp'
          ? `Your OAuth session may have expired. Disconnect and reconnect the Minds connector in Claude. If the OAuth popup never completes, fall back to API key auth: ${apiKeysUrl}`
          : `Connect your Minds account via OAuth or provide an API key (${apiKeysUrl}).`,
  }
}

/* ---------------------------------------------------------------------- *
 * Locale strings — supported languages.                                  *
 * Stored inline (not in i18n files) because this lives in the API tier   *
 * and gets evaluated before any user context exists.                     *
 * ---------------------------------------------------------------------- */

type SupportedLang = 'en' | 'de' | 'fr' | 'es' | 'zh' | 'tr' | 'ar' | 'ja' | 'ko'

interface AuthRequiredCopy {
  generic: string
  openaiResponses: string
  anthropic: string
  docsHint: string
  anchor: string
}

const AUTH_REQUIRED_MESSAGES: Record<SupportedLang, AuthRequiredCopy> = {
  en: {
    generic: 'Authentication required. Connect your Minds account via OAuth or provide an API key.',
    openaiResponses:
      'Authentication required. This MCP call is being executed server-side by OpenAI/OpenRouter, which cannot perform the OAuth handshake — switch your tool config from OAuth to a static "Authorization: Bearer minds_..." API key.',
    anthropic:
      'Authentication required. Your OAuth session may have expired — disconnect and reconnect the Minds connector to re-authorize.',
    docsHint: 'Setup guide:',
    anchor: 'openrouter-open-webui-and-openai-compatible-gateways',
  },
  de: {
    generic: 'Authentifizierung erforderlich. Verbinde dein Minds-Konto via OAuth oder hinterlege einen API-Key.',
    openaiResponses:
      'Authentifizierung erforderlich. Dieser MCP-Aufruf wird serverseitig von OpenAI/OpenRouter ausgeführt — der OAuth-Handshake ist auf diesem Pfad nicht möglich. Stell deine Tool-Konfiguration von OAuth auf einen statischen "Authorization: Bearer minds_..."-API-Key um.',
    anthropic:
      'Authentifizierung erforderlich. Deine OAuth-Sitzung ist möglicherweise abgelaufen — Minds-Connector trennen und neu verbinden, um neu zu autorisieren.',
    docsHint: 'Setup-Anleitung:',
    anchor: 'openrouter-open-webui-und-openai-kompatible-gateways',
  },
  fr: {
    generic: 'Authentification requise. Connecte ton compte Minds via OAuth ou fournis une clé API.',
    openaiResponses:
      'Authentification requise. Cet appel MCP est exécuté côté serveur par OpenAI/OpenRouter, qui ne peut pas effectuer le handshake OAuth — bascule la configuration de ton outil de OAuth vers une clé API statique "Authorization: Bearer minds_...".',
    anthropic:
      'Authentification requise. Ta session OAuth a peut-être expiré — déconnecte et reconnecte le connecteur Minds pour ré-autoriser.',
    docsHint: 'Guide de configuration :',
    anchor: 'openrouter-open-webui-et-passerelles-compatibles-openai',
  },
  es: {
    generic: 'Autenticación requerida. Conecta tu cuenta de Minds vía OAuth o proporciona una clave API.',
    openaiResponses:
      'Autenticación requerida. Esta llamada MCP la ejecuta del lado del servidor OpenAI/OpenRouter, que no puede realizar el handshake OAuth — cambia la configuración de tu herramienta de OAuth a una clave API estática "Authorization: Bearer minds_...".',
    anthropic:
      'Autenticación requerida. Tu sesión OAuth puede haber expirado — desconecta y reconecta el conector de Minds para volver a autorizar.',
    docsHint: 'Guía de configuración:',
    anchor: 'openrouter-open-webui-y-pasarelas-compatibles-con-openai',
  },
  zh: {
    generic: '需要身份验证。请通过 OAuth 连接你的 Minds 账户，或提供 API 密钥。',
    openaiResponses:
      '需要身份验证。此 MCP 调用由 OpenAI/OpenRouter 在服务端执行，无法完成 OAuth 握手——请将工具配置从 OAuth 切换到静态 "Authorization: Bearer minds_..." API 密钥。',
    anthropic: '需要身份验证。你的 OAuth 会话可能已过期——断开并重新连接 Minds 连接器以重新授权。',
    docsHint: '配置指南：',
    anchor: 'openrouteropen-webui-与-openai-兼容网关',
  },
  tr: {
    generic: 'Kimlik doğrulama gerekli. Minds hesabını OAuth ile bağla veya bir API anahtarı sağla.',
    openaiResponses:
      'Kimlik doğrulama gerekli. Bu MCP çağrısı OpenAI/OpenRouter tarafından sunucu tarafında çalıştırılıyor; OAuth el sıkışması bu yolda mümkün değil — araç yapılandırmanı OAuth\'tan statik bir "Authorization: Bearer minds_..." API anahtarına geçir.',
    anthropic:
      'Kimlik doğrulama gerekli. OAuth oturumun süresi dolmuş olabilir — Minds bağlayıcısını kaldırıp yeniden bağlayarak yeniden yetkilendir.',
    docsHint: 'Kurulum kılavuzu:',
    anchor: 'openrouter-open-webui-ve-openai-uyumlu-ağ-geçitleri',
  },
  ar: {
    generic: 'المصادقة مطلوبة. اربط حساب Minds عبر OAuth أو قدّم مفتاح API.',
    openaiResponses:
      'المصادقة مطلوبة. يتم تنفيذ هذا الاستدعاء عبر MCP من جانب الخادم بواسطة OpenAI/OpenRouter، الذي لا يمكنه إجراء مصافحة OAuth — بدّل إعداد الأداة من OAuth إلى مفتاح API ثابت "Authorization: Bearer minds_...".',
    anthropic:
      'المصادقة مطلوبة. ربما انتهت صلاحية جلسة OAuth الخاصة بك — افصل موصّل Minds وأعد توصيله لإعادة التفويض.',
    docsHint: 'دليل الإعداد:',
    anchor: 'openrouter-وopen-webui-والبوابات-المتوافقة-مع-openai',
  },
  ja: {
    generic: '認証が必要です。OAuthでMindsアカウントを接続するか、APIキーを指定してください。',
    openaiResponses:
      '認証が必要です。このMCP呼び出しはOpenAI/OpenRouterによってサーバー側で実行されるため、OAuthハンドシェイクを実行できません。ツール設定をOAuthから静的な "Authorization: Bearer minds_..." APIキーに切り替えてください。',
    anthropic:
      '認証が必要です。OAuthセッションの有効期限が切れている可能性があります。Mindsコネクターを切断して再接続し、再認証してください。',
    docsHint: 'セットアップガイド:',
    anchor: 'openrouter-open-webui-and-openai-compatible-gateways',
  },
  ko: {
    generic: '인증이 필요합니다. OAuth로 Minds 계정을 연결하거나 API 키를 제공하세요.',
    openaiResponses:
      '인증이 필요합니다. 이 MCP 호출은 OpenAI/OpenRouter가 서버 측에서 실행하므로 OAuth 핸드셰이크를 수행할 수 없습니다. 도구 설정을 OAuth에서 정적 "Authorization: Bearer minds_..." API 키로 전환하세요.',
    anthropic:
      '인증이 필요합니다. OAuth 세션이 만료되었을 수 있습니다. Minds 커넥터 연결을 해제한 뒤 다시 연결하여 재인증하세요.',
    docsHint: '설정 가이드:',
    anchor: 'openrouter-open-webui-and-openai-compatible-gateways',
  },
}

/**
 * Pick the best supported language from an Accept-Language header.
 * Falls back to English. Doesn't do full RFC 7231 parsing — we don't need
 * weighted ranking for a 401 body.
 */
function pickSupportedLang(acceptLanguage?: string): SupportedLang {
  if (!acceptLanguage) return 'en'
  const tags = acceptLanguage.toLowerCase().split(',').map(t => t.split(';')[0].trim())
  for (const tag of tags) {
    const primary = tag.split('-')[0]
    if (primary === 'en' || primary === 'de' || primary === 'fr' || primary === 'es' || primary === 'zh' || primary === 'tr' || primary === 'ar' || primary === 'ja' || primary === 'ko') {
      return primary as SupportedLang
    }
  }
  return 'en'
}
