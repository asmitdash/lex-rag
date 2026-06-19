// Shared Bedrock client. All Claude calls (planner, judge, GraphRAG synthesis)
// go through one of these helpers — no direct InvokeModelCommand elsewhere in
// the lex-rag codebase.
//
// Model: global.anthropic.claude-opus-4-7 (overridable via BEDROCK_MODEL_ID).

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-opus-4-7'

let client: BedrockRuntimeClient | null = null
function getClient(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({ region: REGION })
  return client
}

export type Tool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

type ContentText = { type: 'text'; text: string }
type ContentToolUse = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type ContentToolResult = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type AssistantContent = ContentText | ContentToolUse
export type UserContent = ContentText | ContentToolResult

export type Message =
  | { role: 'user'; content: string | UserContent[] }
  | { role: 'assistant'; content: AssistantContent[] }

export type ClaudeResponse = {
  stop_reason:
    | 'end_turn'
    | 'tool_use'
    | 'max_tokens'
    | 'stop_sequence'
    | string
  content: AssistantContent[]
  usage?: { input_tokens: number; output_tokens: number }
}

export async function claudeMessages(opts: {
  system: string
  messages: Message[]
  tools?: Tool[]
  max_tokens?: number
  temperature?: number
}): Promise<ClaudeResponse> {
  const body: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: opts.max_tokens ?? 2048,
    temperature: opts.temperature ?? 0,
    system: opts.system,
    messages: opts.messages,
  }
  if (opts.tools && opts.tools.length) body.tools = opts.tools

  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  })
  const res = await getClient().send(cmd)
  const decoded = new TextDecoder().decode(res.body)
  return JSON.parse(decoded) as ClaudeResponse
}

export async function claudeOneShot(opts: {
  system: string
  user: string
  max_tokens?: number
  temperature?: number
}): Promise<string> {
  const r = await claudeMessages({
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    max_tokens: opts.max_tokens ?? 2048,
    temperature: opts.temperature ?? 0,
  })
  return r.content
    .filter((c): c is ContentText => c.type === 'text')
    .map(c => c.text)
    .join('\n')
}
