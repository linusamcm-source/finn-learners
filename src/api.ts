import type { AnswerInput, FeedItem, ParentSummary, SessionRow } from '../shared/types.ts'

/**
 * Raised when the server cannot be reached at all, as opposed to reaching it
 * and being told no. Installed on a phone these are very different situations
 * and the learner deserves to be told which one they are in.
 */
export class OfflineError extends Error {
  constructor() {
    super(
      navigator.onLine
        ? 'Cannot reach the learner-dash server. It needs to be running, and this device needs to be on the same network as it.'
        : 'This device is offline. Practice needs the learner-dash server so that progress can be recorded.',
    )
    this.name = 'OfflineError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...init,
    })
  } catch {
    // fetch only rejects on a network-level failure, never on an HTTP error.
    throw new OfflineError()
  }
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
