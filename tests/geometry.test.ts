import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  actorPlacement,
  lightColourAt,
  placementAt,
  polylineLength,
} from '../src/scenario/geometry.ts'
import type { Actor } from '../shared/types.ts'

const p = (x: number, y: number) => ({ x, y })

describe('polyline travel', () => {
  test('measures total length across segments', () => {
    assert.equal(polylineLength([p(0, 0), p(3, 0), p(3, 4)]), 7)
  })

  test('places a body part-way along the first segment', () => {
    // 10 m/s for 500 ms = 5 m along a 10 m segment.
    const at = placementAt([p(0, 0), p(10, 0)], 10, 500)
    assert.deepEqual(at.position, { x: 5, y: 0 })
    assert.equal(at.heading, 0)
    assert.equal(at.visible, true)
  })

  test('carries over into later segments', () => {
    const at = placementAt([p(0, 0), p(10, 0), p(10, 10)], 10, 1500)
    assert.deepEqual(at.position, { x: 10, y: 5 })
    assert.equal(Math.round(at.heading * 100) / 100, Math.round((Math.PI / 2) * 100) / 100)
  })

  test('holds at the final waypoint rather than vanishing', () => {
    const at = placementAt([p(0, 0), p(10, 0)], 10, 999_999)
    assert.deepEqual(at.position, { x: 10, y: 0 })
    assert.equal(at.visible, true)
  })

  test('a stationary body stays put', () => {
    const at = placementAt([p(4, 4), p(4, 4)], 0, 5000)
    assert.deepEqual(at.position, { x: 4, y: 4 })
  })
})

describe('actor appearance', () => {
  const actor: Actor = {
    id: 'a',
    kind: 'pedestrian',
    startPosition: p(0, 0),
    path: [p(10, 0)],
    speed: 2,
    appearTime: 2000,
  }

  test('is hidden before appearTime', () => {
    assert.equal(actorPlacement(actor, 1999).visible, false)
  })

  test('starts moving from its own appearTime, not from t=0', () => {
    const at = actorPlacement(actor, 3000)
    assert.equal(at.visible, true)
    assert.deepEqual(at.position, { x: 2, y: 0 })
  })
})

describe('traffic light phases', () => {
  const phases = { greenMs: 5000, yellowMs: 2000, redMs: 3000, offsetMs: 0 }

  test('cycles green, yellow, red', () => {
    assert.equal(lightColourAt(phases, 0), 'green')
    assert.equal(lightColourAt(phases, 4999), 'green')
    assert.equal(lightColourAt(phases, 5000), 'yellow')
    assert.equal(lightColourAt(phases, 6999), 'yellow')
    assert.equal(lightColourAt(phases, 7000), 'red')
    assert.equal(lightColourAt(phases, 9999), 'red')
  })

  test('wraps around at the end of the cycle', () => {
    assert.equal(lightColourAt(phases, 10_000), 'green')
    assert.equal(lightColourAt(phases, 15_000), 'yellow')
  })

  test('offset shifts the phase at t=0', () => {
    assert.equal(lightColourAt({ ...phases, offsetMs: 7000 }, 0), 'red')
  })

  test('a zero-length cycle does not divide by zero', () => {
    assert.equal(lightColourAt({ greenMs: 0, yellowMs: 0, redMs: 0, offsetMs: 0 }, 1234), 'green')
  })
})
