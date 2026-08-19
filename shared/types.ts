/**
 * Shared data contracts for learner-dash.
 *
 * These types are the single source of truth for the JSON on disk
 * (content/handbook.json, content/questions.json, content/scenarios.json)
 * and for the HTTP API between server/ and src/.
 */

/** The nine topics the question bank and scenarios are indexed by. */
export const TOPICS = [
  'speed-limits',
  'give-way',
  'roundabouts',
  'turns',
  'road-signs',
  'line-markings',
  'sharing-road',
  'alcohol-drugs-fatigue',
  'learner-p-plater',
] as const

export type Topic = (typeof TOPICS)[number]

export const TOPIC_LABELS: Record<Topic, string> = {
  'speed-limits': 'Speed limits',
  'give-way': 'Giving way & intersections',
  roundabouts: 'Roundabouts',
  turns: 'Making turns',
  'road-signs': 'Road signs',
  'line-markings': 'Line markings',
  'sharing-road': 'Sharing the road',
  'alcohol-drugs-fatigue': 'Alcohol, drugs & fatigue',
  'learner-p-plater': 'Learner & P-plater rules',
}

export function isTopic(value: unknown): value is Topic {
  return typeof value === 'string' && (TOPICS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * Phase 1 — handbook
 * ------------------------------------------------------------------ */

export interface HandbookSection {
  id: string
  chapter: string
  title: string
  body: string
  pageRef: number
  images: string[]
}

export interface HandbookChapter {
  title: string
  startPage: number
  endPage: number
  sections: HandbookSection[]
}

export interface Handbook {
  source: {
    title: string
    url: string
    /** ISO date the PDF was fetched. */
    retrievedAt: string
    sha256: string
    pageCount: number
  }
  chapters: HandbookChapter[]
}

/* ------------------------------------------------------------------ *
 * Phase 2 — question bank
 * ------------------------------------------------------------------ */

export interface RuleRef {
  chapter: string
  /**
   * Handbook page number. Null until reconciled against an ingested
   * handbook.json — see `just verify-content`. Never guess this by hand:
   * a wrong page reference sends the learner to the wrong rule.
   */
  page: number | null
}

export interface Question {
  id: string
  topic: Topic
  text: string
  options: string[]
  correctIndex: number
  explanation: string
  ruleRef: RuleRef
  /** Path under assets/handbook/, when a diagram supports the question. */
  image?: string
  /**
   * False until a human has checked the question against the handbook.
   * The feed still serves unverified questions; the parent view surfaces
   * how many remain unchecked.
   */
  verified: boolean
}

/* ------------------------------------------------------------------ *
 * Phase 3 — scenarios
 * ------------------------------------------------------------------ */

export type RoadType =
  | 'four-way-intersection'
  | 'roundabout'
  | 't-junction'
  | 'rural-road'
  | 'multi-lane'

/** Approach identifiers, named for the edge of the canvas they enter from. */
export type Approach = 'north' | 'east' | 'south' | 'west'

export type ControlKind = 'stop-sign' | 'give-way-sign' | 'traffic-light'

export interface TrafficLightPhases {
  /** Milliseconds each phase holds, cycling green -> yellow -> red. */
  greenMs: number
  yellowMs: number
  redMs: number
  /** Milliseconds into the cycle at scenario t=0. */
  offsetMs: number
}

export interface Control {
  kind: ControlKind
  approach: Approach
  /** Required when kind is 'traffic-light'. */
  phases?: TrafficLightPhases
}

export interface Layout {
  roadType: RoadType
  /** Lane count per approach, counting lanes in the direction of travel. */
  lanes: Partial<Record<Approach, number>>
  controls: Control[]
  /** Posted limit, drawn as a sign in the corner. Purely informational. */
  speedLimitKmh?: number
}

/** Scenario coordinates are metres on a 60m x 60m field centred on (0,0). */
export interface Point {
  x: number
  y: number
}

export type ActorKind = 'car' | 'truck' | 'bus' | 'motorcycle' | 'cyclist' | 'pedestrian'

export interface Actor {
  id: string
  kind: ActorKind
  startPosition: Point
  /** Waypoints travelled in order, at `speed`. */
  path: Point[]
  /** Metres per second. */
  speed: number
  /** Milliseconds before the actor enters the scene. Defaults to 0. */
  appearTime?: number
  /** Optional label drawn beside the actor, e.g. "indicating left". */
  note?: string
}

export interface Ego {
  startPosition: Point
  path: Point[]
  speed: number
  /**
   * When true the learner steers; when false the ego vehicle plays out
   * its path automatically. The MVP renders both, but only automatic
   * playback is assessed.
   */
  driverControlled: boolean
}

export interface HazardAssessment {
  kind: 'hazard-perception'
  /** Window, in ms from scenario start, in which a tap counts as correct. */
  responseWindowMs: { startMs: number; endMs: number }
  /** The actor that constitutes the hazard. */
  hazardActorId?: string
  /** Alternative to hazardActorId: a region of the field. */
  hazardArea?: { centre: Point; radius: number }
  explanation: string
}

export interface RulesAssessment {
  kind: 'rules-question'
  text: string
  options: string[]
  correctIndex: number
  explanation: string
  ruleRef: RuleRef
}

export type Assessment = HazardAssessment | RulesAssessment

export interface Scenario {
  id: string
  topic: Topic
  title: string
  /** Total playback length in milliseconds. */
  durationMs: number
  layout: Layout
  actors: Actor[]
  ego: Ego
  assessment: Assessment
  verified: boolean
}

/* ------------------------------------------------------------------ *
 * Phase 4 — the feed
 * ------------------------------------------------------------------ */

export type FeedItem =
  | { kind: 'question'; id: string; topic: Topic; question: Question }
  | { kind: 'scenario'; id: string; topic: Topic; scenario: Scenario }

/* ------------------------------------------------------------------ *
 * Phase 5 — sessions and stats
 * ------------------------------------------------------------------ */

export interface SessionRow {
  id: number
  startedAt: string
  endedAt: string | null
  itemCount: number
}

export interface AnswerInput {
  sessionId: number
  itemId: string
  topic: Topic
  correct: boolean
  responseTimeMs: number
}

export interface TopicStat {
  topic: Topic
  label: string
  answered: number
  correct: number
  accuracy: number | null
}

export interface TrendPoint {
  /** ISO date, YYYY-MM-DD. */
  date: string
  answered: number
  correct: number
  accuracy: number | null
}

export interface ParentSummary {
  sessionsThisWeek: number
  itemsThisWeek: number
  totalItemsAnswered: number
  totalSessions: number
  overallAccuracy: number | null
  byTopic: TopicStat[]
  weakestTopics: TopicStat[]
  trend: TrendPoint[]
  recentSessions: Array<SessionRow & { accuracy: number | null }>
  content: { questions: number; scenarios: number; unverified: number }
}
