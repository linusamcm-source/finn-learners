/**
 * Phase 3 — the canvas renderer.
 *
 * One renderer draws every scenario. It reads nothing but the scenario
 * schema, so a new scenario is a JSON file and never a code change.
 *
 * Top-down view, simple shapes: rectangles for vehicles, circles for
 * pedestrians. Which arms an intersection has comes from the keys of
 * `layout.lanes`, and `roadType` decides what happens where they meet.
 */
import type {
  Actor,
  ActorKind,
  Approach,
  Control,
  Layout,
  Point,
  Scenario,
} from '../../shared/types.ts'
import {
  FIELD_SIZE_M,
  LANE_WIDTH_M,
  actorPlacement,
  egoPlacement,
  lightColourAt,
  type Placement,
} from './geometry.ts'

const COLOURS = {
  grass: '#dfe4d7',
  road: '#4a4a4f',
  lineWhite: '#f2f2ee',
  lineYellow: '#e8c34a',
  island: '#c9d2bd',
  ego: '#2f6fd0',
  car: '#c94f4f',
  truck: '#7a5c3a',
  bus: '#3f8a54',
  motorcycle: '#8a4fa8',
  cyclist: '#d98324',
  pedestrian: '#222227',
  signGiveWay: '#f2f2ee',
  signStop: '#c0392b',
  hazard: '#ffcc00',
} as const

/** Vehicle footprints in metres, length along the direction of travel. */
const FOOTPRINT: Record<ActorKind, { length: number; width: number }> = {
  car: { length: 4.6, width: 1.9 },
  truck: { length: 9.0, width: 2.5 },
  bus: { length: 12.0, width: 2.5 },
  motorcycle: { length: 2.2, width: 0.8 },
  cyclist: { length: 1.8, width: 0.7 },
  pedestrian: { length: 0.7, width: 0.7 },
}

const ROUNDABOUT_ISLAND_R = 6
const APPROACH_ANGLE: Record<Approach, number> = {
  north: Math.PI / 2,
  east: 0,
  south: -Math.PI / 2,
  west: Math.PI,
}

export interface RenderOptions {
  /** Draw a marker over the hazard — used when revealing the answer. */
  revealHazard?: boolean
}

export class ScenarioRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private scenario: Scenario
  private scale = 1
  private originX = 0
  private originY = 0

  constructor(canvas: HTMLCanvasElement, scenario: Scenario) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    this.canvas = canvas
    this.ctx = ctx
    this.scenario = scenario
    this.resize()
  }

  setScenario(scenario: Scenario): void {
    this.scenario = scenario
  }

  /** Match the backing store to the element's box and the device pixel ratio. */
  resize(): void {
    const ratio = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    const size = Math.max(1, Math.min(rect.width, rect.height) || 1)
    this.canvas.width = Math.round(size * ratio)
    this.canvas.height = Math.round(size * ratio)
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    this.scale = size / FIELD_SIZE_M
    this.originX = size / 2
    this.originY = size / 2
  }

  /** Scenario metres to canvas pixels. Scenario y points north, canvas y points down. */
  private toPx(p: Point): { x: number; y: number } {
    return { x: this.originX + p.x * this.scale, y: this.originY - p.y * this.scale }
  }

  /** Canvas pixels back to scenario metres, for hit testing taps. */
  toScenarioPoint(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - this.originX) / this.scale,
      y: -(clientY - rect.top - this.originY) / this.scale,
    }
  }

  private m(metres: number): number {
    return metres * this.scale
  }

  draw(timeMs: number, options: RenderOptions = {}): void {
    const { ctx } = this
    const size = FIELD_SIZE_M * this.scale

    ctx.fillStyle = COLOURS.grass
    ctx.fillRect(0, 0, size, size)

    this.drawRoads(this.scenario.layout)
    this.drawControls(this.scenario.layout, timeMs)

    for (const actor of this.scenario.actors) {
      const placement = actorPlacement(actor, timeMs)
      if (!placement.visible) continue
      this.drawActor(actor, placement)
    }

    const ego = egoPlacement(this.scenario.ego, timeMs)
    this.drawBody(ego, FOOTPRINT.car, COLOURS.ego, true)

    if (options.revealHazard) this.drawHazardMarker(timeMs)
  }

  /* ---------------------------------------------------------------- *
   * Road surface
   * ---------------------------------------------------------------- */

  private armHalfWidth(layout: Layout, approach: Approach): number {
    const lanes = layout.lanes[approach] ?? 1
    // Lane count is per direction of travel, so a two-way arm is twice as wide.
    return lanes * LANE_WIDTH_M
  }

  private approaches(layout: Layout): Approach[] {
    return (Object.keys(layout.lanes) as Approach[]).filter((a) => (layout.lanes[a] ?? 0) > 0)
  }

  private drawRoads(layout: Layout): void {
    const { ctx } = this
    const approaches = this.approaches(layout)
    const reach = FIELD_SIZE_M / 2

    ctx.fillStyle = COLOURS.road
    for (const approach of approaches) {
      const half = this.armHalfWidth(layout, approach)
      const angle = APPROACH_ANGLE[approach]
      const centre = this.toPx({ x: 0, y: 0 })

      ctx.save()
      ctx.translate(centre.x, centre.y)
      ctx.rotate(-angle)
      // Arms run from the centre outwards; overlapping at the centre is what
      // forms the intersection surface.
      ctx.fillRect(0, -this.m(half), this.m(reach), this.m(half * 2))
      ctx.restore()
    }

    if (layout.roadType === 'roundabout') this.drawRoundaboutCarriageway(layout)

    for (const approach of approaches) this.drawArmMarkings(layout, approach)

    if (layout.roadType === 'roundabout') this.drawRoundaboutCentre()
  }

  private drawArmMarkings(layout: Layout, approach: Approach): void {
    const { ctx } = this
    const half = this.armHalfWidth(layout, approach)
    const angle = APPROACH_ANGLE[approach]
    const centre = this.toPx({ x: 0, y: 0 })
    const lanes = layout.lanes[approach] ?? 1

    // Markings start clear of the intersection itself.
    const gap =
      layout.roadType === 'roundabout'
        ? ROUNDABOUT_ISLAND_R + LANE_WIDTH_M * 1.6
        : Math.max(...this.approaches(layout).map((a) => this.armHalfWidth(layout, a)))

    ctx.save()
    ctx.translate(centre.x, centre.y)
    ctx.rotate(-angle)

    // Centre line, separating the two directions of travel.
    ctx.strokeStyle = COLOURS.lineWhite
    ctx.lineWidth = Math.max(1, this.m(0.12))
    ctx.setLineDash([this.m(2), this.m(2.5)])
    ctx.beginPath()
    ctx.moveTo(this.m(gap), 0)
    ctx.lineTo(this.m(FIELD_SIZE_M / 2), 0)
    ctx.stroke()

    // Lane lines within each direction, where the arm has more than one lane.
    for (let i = 1; i < lanes; i++) {
      const offset = i * LANE_WIDTH_M
      for (const sign of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(this.m(gap), sign * this.m(offset))
        ctx.lineTo(this.m(FIELD_SIZE_M / 2), sign * this.m(offset))
        ctx.stroke()
      }
    }

    ctx.setLineDash([])
    ctx.restore()
    void half
  }

  /**
   * The circulating carriageway, laid over the arms so they read as feeding a
   * ring rather than crossing straight through under the island.
   */
  private drawRoundaboutCarriageway(layout: Layout): void {
    const { ctx } = this
    const centre = this.toPx({ x: 0, y: 0 })
    const widest = Math.max(1, ...this.approaches(layout).map((a) => layout.lanes[a] ?? 1))
    const outer = ROUNDABOUT_ISLAND_R + widest * LANE_WIDTH_M

    ctx.fillStyle = COLOURS.road
    ctx.beginPath()
    ctx.arc(centre.x, centre.y, this.m(outer), 0, Math.PI * 2)
    ctx.fill()

    // Lane line between the two circulating lanes, where there are two.
    if (widest > 1) {
      ctx.strokeStyle = COLOURS.lineWhite
      ctx.lineWidth = Math.max(1, this.m(0.12))
      ctx.setLineDash([this.m(1.8), this.m(2.2)])
      ctx.beginPath()
      ctx.arc(centre.x, centre.y, this.m(ROUNDABOUT_ISLAND_R + LANE_WIDTH_M), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private drawRoundaboutCentre(): void {
    const { ctx } = this
    const centre = this.toPx({ x: 0, y: 0 })
    ctx.fillStyle = COLOURS.island
    ctx.beginPath()
    ctx.arc(centre.x, centre.y, this.m(ROUNDABOUT_ISLAND_R), 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = COLOURS.lineWhite
    ctx.lineWidth = Math.max(1, this.m(0.15))
    ctx.stroke()
  }

  /* ---------------------------------------------------------------- *
   * Signs and signals
   * ---------------------------------------------------------------- */

  private drawControls(layout: Layout, timeMs: number): void {
    for (const control of layout.controls) this.drawControl(layout, control, timeMs)
  }

  private drawControl(layout: Layout, control: Control, timeMs: number): void {
    const { ctx } = this
    const angle = APPROACH_ANGLE[control.approach]
    const half = this.armHalfWidth(layout, control.approach)
    const setback = half + 3
    // Signs sit on the left of the approaching driver, which is the far side
    // of the arm from the centre line as seen from outside the intersection.
    const lateral = half + 2
    const anchor = this.toPx({
      x: Math.cos(angle) * setback - Math.sin(angle) * -lateral,
      y: Math.sin(angle) * setback + Math.cos(angle) * -lateral,
    })

    ctx.save()
    ctx.translate(anchor.x, anchor.y)

    if (control.kind === 'traffic-light') {
      const colour = control.phases ? lightColourAt(control.phases, timeMs) : 'green'
      const r = this.m(1.1)
      ctx.fillStyle = '#1b1b1f'
      ctx.fillRect(-r, -r * 2.6, r * 2, r * 5.2)
      const lamps: Array<[string, number]> = [
        ['#c0392b', -1.6],
        ['#e8c34a', 0],
        ['#3f8a54', 1.6],
      ]
      const active = colour === 'red' ? 0 : colour === 'yellow' ? 1 : 2
      lamps.forEach(([lampColour, offset], index) => {
        ctx.beginPath()
        ctx.arc(0, r * offset, r * 0.62, 0, Math.PI * 2)
        ctx.fillStyle = index === active ? lampColour : '#3a3a40'
        ctx.fill()
      })
    } else if (control.kind === 'stop-sign') {
      const r = this.m(1.5)
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + Math.PI / 8
        const px = Math.cos(a) * r
        const py = Math.sin(a) * r
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = COLOURS.signStop
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.max(7, this.m(0.9))}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('STOP', 0, 0)
    } else {
      const r = this.m(1.6)
      ctx.beginPath()
      ctx.moveTo(0, r)
      ctx.lineTo(-r, -r * 0.8)
      ctx.lineTo(r, -r * 0.8)
      ctx.closePath()
      ctx.fillStyle = COLOURS.signGiveWay
      ctx.fill()
      ctx.strokeStyle = COLOURS.signStop
      ctx.lineWidth = Math.max(1.5, this.m(0.28))
      ctx.stroke()
    }

    ctx.restore()
  }

  /* ---------------------------------------------------------------- *
   * Actors
   * ---------------------------------------------------------------- */

  private drawActor(actor: Actor, placement: Placement): void {
    if (actor.kind === 'pedestrian') {
      const { ctx } = this
      const px = this.toPx(placement.position)
      ctx.beginPath()
      ctx.arc(px.x, px.y, this.m(0.45), 0, Math.PI * 2)
      ctx.fillStyle = COLOURS.pedestrian
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    } else {
      this.drawBody(placement, FOOTPRINT[actor.kind], COLOURS[actor.kind], false)
    }
    if (actor.note) this.drawNote(placement.position, actor.note)
  }

  private drawBody(
    placement: Placement,
    footprint: { length: number; width: number },
    colour: string,
    isEgo: boolean,
  ): void {
    const { ctx } = this
    const px = this.toPx(placement.position)

    ctx.save()
    ctx.translate(px.x, px.y)
    // Canvas y grows downwards, so a scenario heading is negated to rotate.
    ctx.rotate(-placement.heading)

    const length = this.m(footprint.length)
    const width = this.m(footprint.width)
    ctx.fillStyle = colour
    ctx.strokeStyle = isEgo ? '#fff' : 'rgba(0,0,0,0.45)'
    ctx.lineWidth = isEgo ? 2 : 1
    ctx.beginPath()
    ctx.roundRect(-length / 2, -width / 2, length, width, Math.min(width / 3, this.m(0.5)))
    ctx.fill()
    ctx.stroke()

    // A lighter wedge at the nose so the direction of travel is readable.
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.beginPath()
    ctx.moveTo(length / 2, 0)
    ctx.lineTo(length / 2 - this.m(0.9), -width / 2 + this.m(0.15))
    ctx.lineTo(length / 2 - this.m(0.9), width / 2 - this.m(0.15))
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  }

  private drawNote(position: Point, note: string): void {
    const { ctx } = this
    const px = this.toPx(position)
    ctx.font = `${Math.max(9, this.m(0.95))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    const width = ctx.measureText(note).width + 14
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(px.x - width / 2, px.y - this.m(2.6), width, this.m(1.6))
    ctx.fillStyle = '#222227'
    ctx.fillText(note, px.x, px.y - this.m(1.2))
  }

  private drawHazardMarker(timeMs: number): void {
    const { assessment, actors } = this.scenario
    if (assessment.kind !== 'hazard-perception') return

    let centre: Point | null = null
    let radius = 3
    if (assessment.hazardActorId) {
      const actor = actors.find((a) => a.id === assessment.hazardActorId)
      if (actor) centre = actorPlacement(actor, timeMs).position
    } else if (assessment.hazardArea) {
      centre = assessment.hazardArea.centre
      radius = assessment.hazardArea.radius
    }
    if (!centre) return

    const { ctx } = this
    const px = this.toPx(centre)
    ctx.beginPath()
    ctx.arc(px.x, px.y, this.m(radius), 0, Math.PI * 2)
    ctx.strokeStyle = COLOURS.hazard
    ctx.lineWidth = 3
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/**
 * Was a tap at `point` on the hazard at `timeMs`? Tapping an actor is judged
 * against a generous radius — the learner is pointing at a moving object on a
 * small screen, not clicking a button.
 */
export function hazardHit(scenario: Scenario, point: Point, timeMs: number): boolean {
  const { assessment } = scenario
  if (assessment.kind !== 'hazard-perception') return false

  if (assessment.hazardActorId) {
    const actor = scenario.actors.find((a) => a.id === assessment.hazardActorId)
    if (!actor) return false
    const placement = actorPlacement(actor, timeMs)
    if (!placement.visible) return false
    return Math.hypot(point.x - placement.position.x, point.y - placement.position.y) <= 3.5
  }

  if (assessment.hazardArea) {
    const { centre, radius } = assessment.hazardArea
    return Math.hypot(point.x - centre.x, point.y - centre.y) <= radius
  }
  return false
}
