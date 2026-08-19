import type { AnswerInput, FeedItem, ParentSummary, SessionRow } from '../shared/types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; hint?: string }
    throw new Error(body.hint ?? body.error ?? `${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

export const api = {
  startSession: () => request<SessionRow>('/api/session/start', { method: 'POST' }),

  endSession: (sessionId: number) =>
    request<{ ok: true }>('/api/session/end', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  nextItem: () => request<FeedItem>('/api/feed/next'),

  recordAnswer: (answer: AnswerInput) =>
    request<{ ok: true }>('/api/answer', { method: 'POST', body: JSON.stringify(answer) }),

  summary: () => request<ParentSummary>('/api/summary'),
}

/**
 * End the session on the way out. `sendBeacon` is used because a normal fetch
 * is routinely cancelled when the page is closing.
 */
export function endSessionOnUnload(sessionId: number): void {
  const payload = JSON.stringify({ sessionId })
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/session/end', new Blob([payload], { type: 'application/json' }))
  } else {
    void api.endSession(sessionId).catch(() => {})
  }
}
