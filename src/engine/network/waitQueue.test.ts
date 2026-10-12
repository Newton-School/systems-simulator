import { describe, expect, it } from 'vitest'
import { KeyedWaitQueue } from './waitQueue'

describe('KeyedWaitQueue', () => {
  it('serves each key oldest first, independently of other keys', () => {
    const queue = new KeyedWaitQueue<number>()
    queue.enqueue('a', 1)
    queue.enqueue('a', 2)
    queue.enqueue('b', 10)
    queue.enqueue('a', 3)
    expect(queue.size('a')).toBe(3)
    expect(queue.first('a')).toBe(1)
    expect(queue.peekLast('a')).toBe(3)
    expect(queue.take('a', 2)).toEqual([1, 2])
    expect(queue.take('b', 5)).toEqual([10])
    expect(queue.size('b')).toBe(0)
    expect(queue.first('b')).toBeUndefined()
  })

  it('puts a requeued waiter back at the front', () => {
    const queue = new KeyedWaitQueue<string>()
    queue.enqueue('k', 'x')
    queue.enqueue('k', 'y')
    expect(queue.take('k', 1)).toEqual(['x'])
    queue.enqueue('k', 'x', true)
    queue.enqueue('k', 'w', true)
    expect(queue.take('k', 3)).toEqual(['w', 'x', 'y'])
  })

  it('removes a timed-out waiter and reports a stale removal', () => {
    const queue = new KeyedWaitQueue<number>()
    for (let value = 0; value < 5; value += 1) queue.enqueue('k', value)
    expect(queue.remove('k', (value) => value === 2)).toBe(true)
    expect(queue.remove('k', (value) => value === 2)).toBe(false)
    expect(queue.find('k', (value) => value > 2)).toBe(3)
    expect(queue.take('k', 10)).toEqual([0, 1, 3, 4])
    expect(queue.remove('k', () => true)).toBe(false)
  })

  it('keeps order across many takes (head compaction)', () => {
    const queue = new KeyedWaitQueue<number>()
    for (let value = 0; value < 5_000; value += 1) queue.enqueue('k', value)
    const taken: number[] = []
    for (let round = 0; round < 3_000; round += 1) taken.push(...queue.take('k', 1))
    queue.enqueue('k', 5_000)
    expect(taken[2_999]).toBe(2_999)
    expect(queue.size('k')).toBe(2_001)
    expect(queue.first('k')).toBe(3_000)
    expect(queue.peekLast('k')).toBe(5_000)
  })
})
