/**
 * Small synthesised sounds. No audio files: a couple of oscillators cost
 * nothing to ship and cannot fail to load offline.
 *
 * Sound is on by default because the app should feel like something, and the
 * toggle sits in the top bar. iOS mutes Web Audio with the physical silent
 * switch anyway, so it cannot surprise anyone in a quiet room.
 */

const STORAGE_KEY = 'learner-dash:sound'

let context: AudioContext | null = null
let enabled = readPreference()

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true // private browsing, or storage refused
  }
}

export function soundEnabled(): boolean {
  return enabled
}

export function toggleSound(): boolean {
  enabled = !enabled
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // A refusal to persist the preference should not stop it applying now.
  }
  if (enabled) void ping(660, 0.06, 0.05)
  return enabled
}

/**
 * Browsers only allow audio to start from a user gesture, so the context is
 * created lazily on the first tap rather than at load.
 */
function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    context ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

function ping(frequency: number, duration: number, gain = 0.08, type: OscillatorType = 'sine'): void {
  const ctx = audio()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.value = frequency
  // A short exponential fade, so it reads as a tap rather than a beep.
  amp.gain.setValueAtTime(gain, ctx.currentTime)
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + duration)
}

export const sfx = {
  correct(): void {
    ping(880, 0.09)
    setTimeout(() => ping(1320, 0.11), 70)
  },
  wrong(): void {
    ping(200, 0.16, 0.07, 'triangle')
  },
  /** A rising arpeggio for a streak milestone — the one moment worth a flourish. */
  milestone(): void {
    ;[660, 880, 1320, 1760].forEach((f, i) => setTimeout(() => ping(f, 0.12, 0.07), i * 80))
  },
  tick(): void {
    ping(520, 0.04, 0.03)
  },
}
