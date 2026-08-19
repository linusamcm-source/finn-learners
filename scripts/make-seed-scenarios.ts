/**
 * One-off seeder for content/scenarios.json.
 *
 * Scenario paths are just polylines in metres, and most of them are
 * straightforward to write by hand — but roundabout arcs are not, so the
 * seeds are laid out here with the geometry computed rather than typed.
 *
 *   node --experimental-strip-types scripts/make-seed-scenarios.ts
 *
 * The JSON it writes is the source of truth once generated. Edit
 * content/scenarios.json directly to tune a scenario; re-running this script
 * overwrites those edits.
 *
 * Conventions
 *   - The field is 60m x 60m centred on (0,0); x is east, y is north.
 *   - Australia drives on the left, so a vehicle heading north sits at
 *     x = -1.75 (one half lane west of the centre line), heading south at
 *     x = +1.75, heading east at y = -1.75, heading west at y = +1.75.
 *   - Roundabout traffic circulates clockwise: from the south arm you pass
 *     the west arm first.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Point, Scenario } from '../shared/types.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'scenarios.json')

const HALF = 1.75 // half a 3.5m lane
const EDGE = 28 // just inside the 30m field edge

/** Lane centre for a vehicle travelling in the given direction. */
const NORTHBOUND = -HALF
const SOUTHBOUND = HALF
const EASTBOUND = -HALF
const WESTBOUND = HALF

/**
 * Centre of the kerbside lane on a two-lane-each-way street. On a residential
 * street that lane is where cars park, which is what makes a pedestrian
 * stepping out of it invisible until the last moment.
 */
const KERBSIDE = -HALF - 3.5

const p = (x: number, y: number): Point => ({ x, y })

/**
 * Waypoints along the roundabout circulating lane, clockwise from
 * `fromDeg` to `toDeg` (degrees, 0 = east, 90 = north).
 */
function arc(fromDeg: number, toDeg: number, radius = 8, steps = 8): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps
    const rad = (deg * Math.PI) / 180
    out.push(p(
      Math.round(Math.cos(rad) * radius * 100) / 100,
      Math.round(Math.sin(rad) * radius * 100) / 100,
    ))
  }
  return out
}

const FOUR_WAY_LANES = { north: 1, east: 1, south: 1, west: 1 } as const

const scenarios: Scenario[] = [
  /* ---------------- hazard perception ---------------- */
  {
    id: 'sc-hazard-001',
    topic: 'sharing-road',
    title: 'Pedestrian steps out between parked cars',
    durationMs: 7000,
    layout: { roadType: 'multi-lane', lanes: { north: 2, south: 2 }, controls: [], speedLimitKmh: 50 },
    actors: [
      { id: 'parked-1', kind: 'car', startPosition: p(KERBSIDE, 4), path: [p(KERBSIDE, 4)], speed: 0 },
      { id: 'parked-2', kind: 'car', startPosition: p(KERBSIDE, 10), path: [p(KERBSIDE, 10)], speed: 0 },
      {
        id: 'pedestrian-1',
        kind: 'pedestrian',
        startPosition: p(-8, 7),
        path: [p(-8, 7), p(0, 7)],
        speed: 1.4,
        appearTime: 2600,
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -26), path: [p(NORTHBOUND, 26)], speed: 13, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 2600, endMs: 5200 },
      hazardActorId: 'pedestrian-1',
      explanation:
        'A pedestrian emerges from between the parked cars. Parked vehicles hide people, especially children, so ease off and move out where you can before you are alongside them.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-002',
    topic: 'give-way',
    title: 'Car pulls out from a side street',
    durationMs: 7000,
    layout: {
      roadType: 't-junction',
      lanes: { north: 1, south: 1, east: 1 },
      controls: [{ kind: 'give-way-sign', approach: 'east' }],
      speedLimitKmh: 60,
    },
    actors: [
      {
        id: 'car-side',
        kind: 'car',
        startPosition: p(14, WESTBOUND),
        path: [p(14, WESTBOUND), p(6, WESTBOUND), p(NORTHBOUND, 6), p(NORTHBOUND, 24)],
        speed: 7,
        appearTime: 1800,
        note: 'not slowing',
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -26), path: [p(NORTHBOUND, 26)], speed: 16, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 1800, endMs: 4200 },
      hazardActorId: 'car-side',
      explanation:
        'The car at the give way sign is not slowing. Right of way is something other drivers give you — cover the brake whenever a vehicle on a side road is still moving.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-003',
    topic: 'sharing-road',
    title: 'Cyclist moves out around a parked car',
    durationMs: 8000,
    layout: { roadType: 'multi-lane', lanes: { north: 2, south: 2 }, controls: [], speedLimitKmh: 50 },
    actors: [
      { id: 'parked-3', kind: 'car', startPosition: p(KERBSIDE, 12), path: [p(KERBSIDE, 12)], speed: 0 },
      {
        id: 'cyclist-1',
        kind: 'cyclist',
        startPosition: p(KERBSIDE, -6),
        path: [p(KERBSIDE, -6), p(KERBSIDE, 5), p(NORTHBOUND, 9), p(NORTHBOUND, 20)],
        speed: 5.5,
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -26), path: [p(NORTHBOUND, 26)], speed: 12, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 1500, endMs: 4800 },
      hazardActorId: 'cyclist-1',
      explanation:
        'The cyclist must move out to clear the parked car and its door zone. Expect it, hold back, and only pass with at least a metre of clearance.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-004',
    topic: 'sharing-road',
    title: 'Car door opens ahead',
    durationMs: 6500,
    layout: { roadType: 'multi-lane', lanes: { north: 2, south: 2 }, controls: [], speedLimitKmh: 50 },
    actors: [
      { id: 'parked-4', kind: 'car', startPosition: p(KERBSIDE, 2), path: [p(KERBSIDE, 2)], speed: 0 },
      {
        id: 'door-1',
        kind: 'pedestrian',
        startPosition: p(-4.3, 2),
        path: [p(-4.3, 2), p(-2.6, 2)],
        speed: 1.1,
        appearTime: 2200,
        note: 'door opening',
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -26), path: [p(NORTHBOUND, 26)], speed: 11, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 2200, endMs: 4400 },
      hazardActorId: 'door-1',
      explanation:
        'A door opens into your path. Passing parked cars, leave a door width of clearance where you can, and look through rear windows for occupants.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-005',
    topic: 'sharing-road',
    title: 'Child runs onto the road',
    durationMs: 6500,
    layout: { roadType: 'rural-road', lanes: { north: 1, south: 1 }, controls: [], speedLimitKmh: 40 },
    actors: [
      {
        id: 'child-1',
        kind: 'pedestrian',
        startPosition: p(8, 6),
        path: [p(8, 6), p(-8, 6)],
        speed: 2.6,
        appearTime: 2000,
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -26), path: [p(NORTHBOUND, 26)], speed: 10, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 2000, endMs: 4200 },
      hazardActorId: 'child-1',
      explanation:
        'A child runs across without checking. Children do not judge traffic well and will not stop for you — in a 40 zone near homes and schools, expect it.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-006',
    topic: 'line-markings',
    title: 'Oncoming vehicle crosses the centre line',
    durationMs: 6500,
    layout: { roadType: 'rural-road', lanes: { north: 1, south: 1 }, controls: [], speedLimitKmh: 100 },
    actors: [
      {
        id: 'oncoming-1',
        kind: 'car',
        startPosition: p(SOUTHBOUND, 28),
        path: [p(SOUTHBOUND, 28), p(SOUTHBOUND, 8), p(-1.0, -2), p(SOUTHBOUND, -20)],
        speed: 22,
        note: 'drifting',
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -28), path: [p(NORTHBOUND, 28)], speed: 22, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 900, endMs: 3200 },
      hazardActorId: 'oncoming-1',
      explanation:
        'The oncoming car drifts across the centre line. Slow, move left towards the edge line, and be ready to leave the sealed surface — never steer right into the lane they are leaving.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-007',
    topic: 'speed-limits',
    title: 'Traffic brakes suddenly ahead',
    durationMs: 7000,
    layout: { roadType: 'multi-lane', lanes: { north: 2, south: 2 }, controls: [], speedLimitKmh: 90 },
    actors: [
      {
        id: 'ahead-1',
        kind: 'car',
        startPosition: p(NORTHBOUND, 6),
        path: [p(NORTHBOUND, 6), p(NORTHBOUND, 20), p(NORTHBOUND, 21)],
        speed: 9,
        note: 'braking',
      },
      { id: 'ahead-2', kind: 'truck', startPosition: p(-5.25, 14), path: [p(-5.25, 14), p(-5.25, 26)], speed: 8 },
    ],
    ego: { startPosition: p(NORTHBOUND, -22), path: [p(NORTHBOUND, 14)], speed: 14, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 1200, endMs: 4000 },
      hazardActorId: 'ahead-1',
      explanation:
        'The vehicle ahead brakes hard for queued traffic. A two second gap is what buys you the room to react — closing up leaves you nothing.',
    },
    verified: false,
  },
  {
    id: 'sc-hazard-008',
    topic: 'give-way',
    title: 'Vehicle runs a red light',
    durationMs: 7000,
    layout: {
      roadType: 'four-way-intersection',
      lanes: FOUR_WAY_LANES,
      controls: [
        { kind: 'traffic-light', approach: 'south', phases: { greenMs: 9000, yellowMs: 2000, redMs: 6000, offsetMs: 0 } },
        { kind: 'traffic-light', approach: 'east', phases: { greenMs: 9000, yellowMs: 2000, redMs: 6000, offsetMs: 11000 } },
      ],
      speedLimitKmh: 60,
    },
    actors: [
      {
        id: 'red-runner',
        kind: 'car',
        startPosition: p(26, WESTBOUND),
        path: [p(26, WESTBOUND), p(-26, WESTBOUND)],
        speed: 18,
        appearTime: 1200,
        note: 'not stopping',
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -24), path: [p(NORTHBOUND, 24)], speed: 14, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 1400, endMs: 3800 },
      hazardActorId: 'red-runner',
      explanation:
        'A vehicle crosses against its red light. A green light is permission, not protection — glance both ways as you enter an intersection even on green.',
    },
    verified: false,
  },

  /* ---------------- rules questions ---------------- */
  {
    id: 'sc-rules-001',
    topic: 'give-way',
    title: 'Uncontrolled intersection, vehicle on the right',
    durationMs: 5000,
    layout: { roadType: 'four-way-intersection', lanes: FOUR_WAY_LANES, controls: [], speedLimitKmh: 50 },
    actors: [
      {
        id: 'from-right',
        kind: 'car',
        startPosition: p(24, WESTBOUND),
        path: [p(24, WESTBOUND), p(-24, WESTBOUND)],
        speed: 9,
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -24), path: [p(NORTHBOUND, -8)], speed: 8, driverControlled: false },
    assessment: {
      kind: 'rules-question',
      text: 'There are no signs or lights. The other car is approaching from your right. What must you do?',
      options: [
        'Proceed — you arrived first',
        'Give way to the car on your right',
        'Give way only if it indicates',
        'Sound your horn and proceed',
      ],
      correctIndex: 1,
      explanation:
        'At an uncontrolled intersection you give way to any vehicle approaching from your right, regardless of who arrived first.',
      ruleRef: { chapter: 'Giving way', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-002',
    topic: 'give-way',
    title: 'Turning right across oncoming traffic',
    durationMs: 5000,
    layout: { roadType: 'four-way-intersection', lanes: FOUR_WAY_LANES, controls: [], speedLimitKmh: 60 },
    actors: [
      {
        id: 'oncoming-2',
        kind: 'car',
        startPosition: p(SOUTHBOUND, 24),
        path: [p(SOUTHBOUND, 24), p(SOUTHBOUND, -24)],
        speed: 11,
      },
    ],
    ego: {
      startPosition: p(NORTHBOUND, -24),
      path: [p(NORTHBOUND, -3), p(4, EASTBOUND), p(24, EASTBOUND)],
      speed: 7,
      driverControlled: false,
    },
    assessment: {
      kind: 'rules-question',
      text: 'You are turning right. The oncoming vehicle is going straight ahead. Who gives way?',
      options: [
        'The oncoming vehicle, because you are already turning',
        'You give way to the oncoming vehicle',
        'Whoever reaches the centre of the intersection first',
        'Neither — both may proceed together',
      ],
      correctIndex: 1,
      explanation:
        'A driver turning right gives way to oncoming traffic going straight ahead or turning left. Turning across a stream never gives you priority over it.',
      ruleRef: { chapter: 'Giving way', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-003',
    topic: 'roundabouts',
    title: 'Entering a roundabout',
    durationMs: 6000,
    layout: { roadType: 'roundabout', lanes: FOUR_WAY_LANES, controls: [], speedLimitKmh: 50 },
    actors: [
      {
        id: 'circulating-1',
        kind: 'car',
        startPosition: p(0, -8),
        path: [...arc(270, 140), p(-24, WESTBOUND)],
        speed: 7,
      },
    ],
    ego: { startPosition: p(NORTHBOUND, -24), path: [p(NORTHBOUND, -11)], speed: 6, driverControlled: false },
    assessment: {
      kind: 'rules-question',
      text: 'A vehicle is already circulating in the roundabout as you approach the entry line. What must you do?',
      options: [
        'Enter — you are on its left',
        'Give way to the vehicle already in the roundabout',
        'Enter and give way once inside',
        'Stop completely and wait for the roundabout to empty',
      ],
      correctIndex: 1,
      explanation:
        'You give way to any vehicle already in the roundabout. A roundabout is a give way situation, not a stop sign — if it is genuinely clear you may keep rolling.',
      ruleRef: { chapter: 'Roundabouts', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-004',
    topic: 'roundabouts',
    title: 'Lane choice for a right turn',
    durationMs: 7000,
    layout: { roadType: 'roundabout', lanes: { north: 2, east: 2, south: 2, west: 2 }, controls: [], speedLimitKmh: 60 },
    actors: [],
    ego: {
      startPosition: p(-5.25, -24),
      path: [p(-5.25, -12), ...arc(255, 20), p(24, EASTBOUND)],
      speed: 7,
      driverControlled: false,
    },
    assessment: {
      kind: 'rules-question',
      text: 'You are approaching this two-lane roundabout intending to turn right. Which lane and signal are correct?',
      options: [
        'Left lane, signalling left',
        'Right lane, signalling right, then left before you exit',
        'Either lane, no signal needed',
        'Left lane, signalling right',
      ],
      correctIndex: 1,
      explanation:
        'To turn right, approach in the right lane and signal right. Once you pass the exit before yours, change the signal to left.',
      ruleRef: { chapter: 'Roundabouts', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-005',
    topic: 'give-way',
    title: 'T-junction with a give way sign',
    durationMs: 5500,
    layout: {
      roadType: 't-junction',
      lanes: { south: 1, east: 1, west: 1 },
      controls: [{ kind: 'give-way-sign', approach: 'south' }],
      speedLimitKmh: 60,
    },
    actors: [
      { id: 'cross-1', kind: 'car', startPosition: p(24, WESTBOUND), path: [p(24, WESTBOUND), p(-24, WESTBOUND)], speed: 12 },
      { id: 'cross-2', kind: 'car', startPosition: p(-24, EASTBOUND), path: [p(-24, EASTBOUND), p(24, EASTBOUND)], speed: 12 },
    ],
    ego: { startPosition: p(NORTHBOUND, -24), path: [p(NORTHBOUND, -6)], speed: 7, driverControlled: false },
    assessment: {
      kind: 'rules-question',
      text: 'You are on the terminating road at a give way sign. Who must you give way to?',
      options: [
        'Only vehicles approaching from your right',
        'All traffic on the continuing road, from both directions',
        'Only vehicles turning into your road',
        'Nobody, provided you slow down',
      ],
      correctIndex: 1,
      explanation:
        'On the terminating road at a T-junction you give way to all traffic on the continuing road, from both directions.',
      ruleRef: { chapter: 'Giving way', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-006',
    topic: 'give-way',
    title: 'Stop sign at a four-way intersection',
    durationMs: 5500,
    layout: {
      roadType: 'four-way-intersection',
      lanes: FOUR_WAY_LANES,
      controls: [
        { kind: 'stop-sign', approach: 'south' },
        { kind: 'stop-sign', approach: 'north' },
      ],
      speedLimitKmh: 50,
    },
    actors: [
      { id: 'cross-3', kind: 'car', startPosition: p(24, WESTBOUND), path: [p(24, WESTBOUND), p(-24, WESTBOUND)], speed: 10 },
    ],
    ego: { startPosition: p(NORTHBOUND, -24), path: [p(NORTHBOUND, -7)], speed: 7, driverControlled: false },
    assessment: {
      kind: 'rules-question',
      text: 'The road ahead is completely clear as you reach the stop sign. What must you do?',
      options: [
        'Slow down and proceed if it is clear',
        'Come to a complete stop at the stop line, then give way',
        'Stop only if another vehicle is approaching',
        'Proceed without stopping, since you can see it is clear',
      ],
      correctIndex: 1,
      explanation:
        'A stop sign requires a complete stop at the stop line every time, even on an empty road, before you give way and proceed.',
      ruleRef: { chapter: 'Giving way', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-007',
    topic: 'turns',
    title: 'Turning left across a pedestrian crossing',
    durationMs: 6000,
    layout: {
      roadType: 'four-way-intersection',
      lanes: FOUR_WAY_LANES,
      controls: [
        { kind: 'traffic-light', approach: 'south', phases: { greenMs: 12000, yellowMs: 2000, redMs: 6000, offsetMs: 0 } },
      ],
      speedLimitKmh: 50,
    },
    actors: [
      {
        id: 'ped-cross',
        kind: 'pedestrian',
        startPosition: p(-9, 6),
        path: [p(-9, 6), p(-9, -6)],
        speed: 1.3,
        appearTime: 800,
      },
    ],
    ego: {
      startPosition: p(NORTHBOUND, -24),
      path: [p(NORTHBOUND, -5), p(-6, WESTBOUND), p(-24, WESTBOUND)],
      speed: 6,
      driverControlled: false,
    },
    assessment: {
      kind: 'rules-question',
      text: 'Your light is green and you are turning left. A pedestrian is crossing the road you are turning into. What must you do?',
      options: [
        'Proceed — your light is green',
        'Give way to the pedestrian',
        'Sound your horn and complete the turn',
        'Give way only if they are already halfway across',
      ],
      correctIndex: 1,
      explanation:
        'A green light does not override pedestrians. When turning you must give way to pedestrians crossing the road you are entering.',
      ruleRef: { chapter: 'Giving way', page: null },
    },
    verified: false,
  },
  {
    id: 'sc-rules-008',
    topic: 'turns',
    title: 'Merging where a lane ends',
    durationMs: 7000,
    layout: { roadType: 'multi-lane', lanes: { north: 2, south: 2 }, controls: [], speedLimitKmh: 80 },
    actors: [
      {
        id: 'merge-other',
        kind: 'car',
        startPosition: p(NORTHBOUND, -14),
        path: [p(NORTHBOUND, -14), p(NORTHBOUND, 26)],
        speed: 15,
        note: 'ahead of you',
      },
    ],
    ego: {
      startPosition: p(-5.25, -24),
      path: [p(-5.25, -4), p(NORTHBOUND, 6), p(NORTHBOUND, 26)],
      speed: 15,
      driverControlled: false,
    },
    assessment: {
      kind: 'rules-question',
      text: 'Your lane is ending and you must merge. The other vehicle is ahead of you. Who gives way?',
      options: [
        'The vehicle in the continuing lane gives way to you',
        'You give way, because its front is ahead of yours',
        'Whichever vehicle is travelling slower',
        'Neither — merge side by side',
      ],
      correctIndex: 1,
      explanation:
        'Where lanes merge you give way to any vehicle already ahead of you. Match its speed and blend into the gap rather than racing for the front.',
      ruleRef: { chapter: 'Making turns', page: null },
    },
    verified: false,
  },
]

writeFileSync(OUT, JSON.stringify(scenarios, null, 2) + '\n', 'utf8')
const hazards = scenarios.filter((s) => s.assessment.kind === 'hazard-perception').length
console.log(
  `[scenarios] wrote ${scenarios.length} scenarios (${hazards} hazard perception, ${scenarios.length - hazards} rules) -> ${OUT}`,
)
