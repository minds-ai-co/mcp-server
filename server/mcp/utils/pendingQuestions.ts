/**
 * In-memory tracker for async panel questions.
 *
 * ask_panel fires the SSE request in the background and returns immediately.
 * This module tracks progress (which Minds have answered) so get_panel_status
 * can report it. Completed questions are cleaned up after 5 minutes.
 */

import { randomUUID } from 'crypto'

export interface PendingAnswer {
  sparkName: string
  groupName: string
  value: string
  discipline?: string
}

export interface PendingQuestion {
  questionId: string
  panelId: string
  question: string
  startedAt: number
  totalMinds: number
  answeredMinds: PendingAnswer[]
  status: 'processing' | 'aggregating' | 'completed' | 'failed'
  outputData?: any
  error?: string
}

const pending = new Map<string, PendingQuestion>()

// Cleanup completed questions after 5 minutes
const CLEANUP_TTL_MS = 5 * 60 * 1000

// .unref() so this timer doesn't pin the Node event loop at build time.
setInterval(() => {
  const now = Date.now()
  for (const [id, q] of pending) {
    if ((q.status === 'completed' || q.status === 'failed') && now - q.startedAt > CLEANUP_TTL_MS) {
      pending.delete(id)
    }
  }
}, 60_000).unref()

export function createPendingQuestion(panelId: string, question: string): PendingQuestion {
  const entry: PendingQuestion = {
    questionId: randomUUID(),
    panelId,
    question,
    startedAt: Date.now(),
    totalMinds: 0,
    answeredMinds: [],
    status: 'processing',
  }
  pending.set(entry.questionId, entry)
  return entry
}

export function updateTotal(questionId: string, total: number) {
  const q = pending.get(questionId)
  if (q) q.totalMinds = total
}

export function addAnswer(questionId: string, answer: PendingAnswer) {
  const q = pending.get(questionId)
  if (q) q.answeredMinds.push(answer)
}

export function markAggregating(questionId: string) {
  const q = pending.get(questionId)
  if (q) q.status = 'aggregating'
}

export function markCompleted(questionId: string, outputData: any) {
  const q = pending.get(questionId)
  if (q) {
    q.status = 'completed'
    q.outputData = outputData
  }
}

export function markFailed(questionId: string, error: string) {
  const q = pending.get(questionId)
  if (q) {
    q.status = 'failed'
    q.error = error
  }
}

export function getQuestion(questionId: string): PendingQuestion | undefined {
  return pending.get(questionId)
}

export function getPanelQuestions(panelId: string): PendingQuestion[] {
  return Array.from(pending.values()).filter(q => q.panelId === panelId)
}
