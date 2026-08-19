/**
 * Scenario geometry. Everything here works in scenario units — metres on a
 * field centred on (0,0) — and knows nothing about canvases or pixels.
 */
import type { Actor, Ego, Point, TrafficLightPhases } from '../../shared/types.ts'

export const LANE_WIDTH_M = 3.5
export const FIELD_SIZE_M = 60

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Cumulative length along a polyline, including the leading start point. */
export function polylineLength(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!)
  return total
}

export interface Placement {
  position: Point
  /** Heading in radians, measured anticlockwise from the positive x axis. */
  heading: number
  /** False before appearTime, or once a finite path has been walked out. */
  visible: boolean
}

/**
 * Where a body travelling at `speed` along `points` has reached after
 * `elapsedMs`. Past the end of the path it holds the final position, which
 * keeps a vehicle parked at its destination rather than vanishing mid-frame.
 */
export function placementAt(
  points: readonly Point[],
  speedMps: number,
  elapsedMs: number,
): Placement {
  const first = points[0]
  if (!first) return { position: { x: 0, y: 0 }, heading: 0, visible: false }
  if (points.length === 1) return { position: first, heading: 0, visible: true }

  const travelled = Math.max(0, (elapsedMs / 1000) * speedMps)
  let remaining = travelled

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!
    const to = points[i]!
    const segment = distance(from, to)
    const heading = Math.atan2(to.y - from.y, to.x - from.x)

    if (segment === 0) continue
    if (remaining <= segment) {
      const ratio = remaining / segment
      return {
        position: { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio },
        heading,
        visible: true,
      }
    }
    remaining -= segment
  }

  const last = points[points.length - 1]!
  const prev = points[points.length - 2]!
  return {
    position: last,
    heading: Math.atan2(last.y - prev.y, last.x - prev.x),
    visible: true,
  }
}

/** Full travel path of an actor: its start position followed by its waypoints. */
export function actorPath(actor: Actor | Ego): Point[] {
  return [actor.startPosition, ...actor.path]
}

export function actorPlacement(actor: Actor, timeMs: number): Placement {
  const appearTime = actor.appearTime ?? 0
  if (timeMs < appearTime) {
    return { position: actor.startPosition, heading: 0, visible: false }
  }
  return placementAt(actorPath(actor), actor.speed, timeMs - appearTime)
}

export function egoPlacement(ego: Ego, timeMs: number): Placement {
  return placementAt(actorPath(ego), ego.speed, timeMs)
}

export type LightColour = 'green' | 'yellow' | 'red'

/** Which colour a traffic light shows at `timeMs` into the scenario. */
export function lightColourAt(phases: TrafficLightPhases, timeMs: number): LightColour {
  const cycle = phases.greenMs + phases.yellowMs + phases.redMs
  if (cycle <= 0) return 'green'
  const at = (((timeMs + phases.offsetMs) % cycle) + cycle) % cycle
  if (at < phases.greenMs) return 'green'
  if (at < phases.greenMs + phases.yellowMs) return 'yellow'
  return 'red'
}
