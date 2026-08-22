/**
 * Checks over the shipped content. These guard the things that would quietly
 * teach the learner something wrong, or make the feed behave oddly.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readContent } from '../scripts/lib/read-content.ts'
import { TOPICS, type Topic } from '../shared/types.ts'
import { actorPlacement, egoPlacement } from '../src/scenario/geometry.ts'

const content = readContent()

describe('the question bank', () => {
  test('loads without rejecting anything', () => {
    assert.deepEqual(content.problems, [])
  })

  test('meets the spec target of roughly 200 questions', () => {
    assert.ok(content.questions.length >= 190, `only ${content.questions.length} questions`)
  })

  test('every topic has enough questions for the feed to draw on', () => {
    for (const topic of TOPICS) {
      const count = content.questions.filter((q) => q.topic === topic).length
      assert.ok(count >= 15, `${topic} has only ${count} questions`)
    }
  })

  test('ids are unique across questions and scenarios alike', () => {
    const ids = [...content.questions.map((q) => q.id), ...content.scenarios.map((s) => s.id)]
    assert.equal(new Set(ids).size, ids.length)
  })

  test('the answer key is not concentrated in one position', () => {
    const counts = new Map<number, number>()
    for (const q of content.questions) counts.set(q.correctIndex, (counts.get(q.correctIndex) ?? 0) + 1)
    const worst = Math.max(...counts.values())
    assert.ok(
      worst / content.questions.length < 0.4,
      'a learner should not be able to pass by always picking the same letter',
    )
  })

  test('every question has four distinct options', () => {
    for (const q of content.questions) {
      assert.equal(q.options.length, 4, `${q.id} has ${q.options.length} options`)
      assert.equal(new Set(q.options).size, 4, `${q.id} repeats an option`)
    }
  })

  test('explanations say more than the option they justify', () => {
    for (const q of content.questions) {
      assert.ok(q.explanation.length > 40, `${q.id} has a thin explanation`)
    }
  })

  test('any referenced diagram lives under assets/handbook/', () => {
    for (const q of content.questions) {
      if (q.image) assert.ok(q.image.startsWith('assets/handbook/'), `${q.id}: ${q.image}`)
    }
  })
})

describe('the scenarios', () => {
  test('there are at least ten seeds, as the spec asks', () => {
    assert.ok(content.scenarios.length >= 10, `only ${content.scenarios.length} scenarios`)
  })

  test('both assessment kinds are represented', () => {
    const kinds = new Set(content.scenarios.map((s) => s.assessment.kind))
    assert.ok(kinds.has('hazard-perception'))
    assert.ok(kinds.has('rules-question'))
  })

  test('every scenario names a topic the feed knows about', () => {
    for (const s of content.scenarios) {
      assert.ok((TOPICS as readonly string[]).includes(s.topic), `${s.id}: ${s.topic}`)
    }
  })

  test('every hazard is visible and inside the field during its response window', () => {
    for (const scenario of content.scenarios) {
      if (scenario.assessment.kind !== 'hazard-perception') continue
      const { startMs, endMs } = scenario.assessment.responseWindowMs
      assert.ok(endMs <= scenario.durationMs, `${scenario.id}: window outruns the scenario`)

      const actorId = scenario.assessment.hazardActorId
      if (!actorId) continue
      const actor = scenario.actors.find((a) => a.id === actorId)!

      for (const t of [startMs, (startMs + endMs) / 2, endMs]) {
        const at = actorPlacement(actor, t)
        assert.ok(at.visible, `${scenario.id}: hazard not yet visible at ${t}ms`)
        assert.ok(
          Math.abs(at.position.x) <= 30 && Math.abs(at.position.y) <= 30,
          `${scenario.id}: hazard is off the field at ${t}ms`,
        )
      }
    }
  })

  test('the response window never opens before the hazard appears', () => {
    for (const scenario of content.scenarios) {
      if (scenario.assessment.kind !== 'hazard-perception') continue
      const actorId = scenario.assessment.hazardActorId
      if (!actorId) continue
      const actor = scenario.actors.find((a) => a.id === actorId)!
      const appearTime = actor.appearTime ?? 0
      assert.ok(
        scenario.assessment.responseWindowMs.startMs >= appearTime,
        `${scenario.id}: window opens at ${scenario.assessment.responseWindowMs.startMs}ms but the hazard appears at ${appearTime}ms, so an early tap could never be credited`,
      )
    }
  })

  test('the ego vehicle stays on the field for the whole scenario', () => {
    for (const scenario of content.scenarios) {
      for (const t of [0, scenario.durationMs / 2, scenario.durationMs]) {
        const at = egoPlacement(scenario.ego, t)
        assert.ok(
          Math.abs(at.position.x) <= 31 && Math.abs(at.position.y) <= 31,
          `${scenario.id}: ego is off the field at ${t}ms (${at.position.x}, ${at.position.y})`,
        )
      }
    }
  })

  test('vehicles approach on the correct side of the road', () => {
    // Australia drives on the left: heading north you sit west of the centre
    // line, heading east you sit south of it, and so on. Only the first
    // segment of each path is checked — that is the lawful approach, before
    // any turn or any deliberate hazard such as a car drifting over the line.
    const VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle'])

    for (const scenario of content.scenarios) {
      for (const actor of scenario.actors) {
        if (!VEHICLES.has(actor.kind) || actor.speed === 0) continue
        const full = [actor.startPosition, ...actor.path]
        // The approach and the final run are both lawful driving. The middle
        // of a path may cross lanes — that is where turns and deliberate
        // hazards such as a car drifting over the line happen.
        const segments: Array<[typeof full[0], typeof full[0], string]> = []
        if (full[1]) segments.push([full[0]!, full[1], 'approach'])
        if (full.length > 2) segments.push([full[full.length - 2]!, full[full.length - 1]!, 'exit'])

        for (const [from, to, which] of segments) {
          const dx = to.x - from.x
          const dy = to.y - from.y
          const where = `${scenario.id}/${actor.id} (${which})`

          if (Math.abs(dx) > 5 && Math.abs(dy) < 0.5) {
            if (dx > 0) assert.ok(from.y < 0, `${where}: heading east but north of the centre line`)
            else assert.ok(from.y > 0, `${where}: heading west but south of the centre line`)
          } else if (Math.abs(dy) > 5 && Math.abs(dx) < 0.5) {
            if (dy > 0) assert.ok(from.x < 0, `${where}: heading north but east of the centre line`)
            else assert.ok(from.x > 0, `${where}: heading south but west of the centre line`)
          }
        }
      }
    }
  })

  test('the ego vehicle also starts on the correct side of the road', () => {
    for (const scenario of content.scenarios) {
      const from = scenario.ego.startPosition
      const to = scenario.ego.path[0]
      if (!to) continue
      const dx = to.x - from.x
      const dy = to.y - from.y
      if (Math.abs(dy) > 5 && Math.abs(dx) < 0.5) {
        if (dy > 0) assert.ok(from.x < 0, `${scenario.id}: ego heading north but east of the centre line`)
        else assert.ok(from.x > 0, `${scenario.id}: ego heading south but west of the centre line`)
      }
    }
  })

  test('parked and stationary vehicles sit within the carriageway', () => {
    for (const scenario of content.scenarios) {
      const halfWidths = Object.values(scenario.layout.lanes).map((n) => (n ?? 0) * 3.5)
      const widest = Math.max(0, ...halfWidths)
      for (const actor of scenario.actors) {
        if (actor.speed !== 0) continue
        assert.ok(
          Math.abs(actor.startPosition.x) + 0.95 <= widest,
          `${scenario.id}/${actor.id}: parked at x=${actor.startPosition.x} but the road only reaches ${widest}m`,
        )
      }
    }
  })

  test('every control names an approach the layout actually has', () => {
    for (const scenario of content.scenarios) {
      for (const control of scenario.layout.controls) {
        assert.ok(
          (scenario.layout.lanes[control.approach] ?? 0) > 0,
          `${scenario.id}: control on ${control.approach}, which has no lanes`,
        )
      }
    }
  })

  test('traffic lights carry phase timings', () => {
    for (const scenario of content.scenarios) {
      for (const control of scenario.layout.controls) {
        if (control.kind !== 'traffic-light') continue
        assert.ok(control.phases, `${scenario.id}: traffic light with no phases`)
        assert.ok(control.phases.greenMs > 0 && control.phases.redMs > 0, `${scenario.id}: degenerate phases`)
      }
    }
  })
})

describe('the feed pool', () => {
  test('covers every topic, so no topic is unreachable', () => {
    const covered = new Set<Topic>(content.pool.map((item) => item.topic))
    for (const topic of TOPICS) assert.ok(covered.has(topic), `${topic} is not in the pool`)
  })

  test('pool ids match their underlying item', () => {
    for (const item of content.pool) {
      const inner = item.kind === 'question' ? item.question.id : item.scenario.id
      assert.equal(item.id, inner)
    }
  })
})
