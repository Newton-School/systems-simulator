import { describe, expect, it } from 'vitest'
import { checkRegisterLinearizability, type RegisterOperation } from './linearizability'

const w = (start: number, end: number, value: number): RegisterOperation => ({
  kind: 'write',
  start,
  end,
  value
})
const r = (start: number, end: number, value: number): RegisterOperation => ({
  kind: 'read',
  start,
  end,
  value
})

describe('single-key register linearizability checker', () => {
  it('accepts an empty history and a sequential one', () => {
    expect(checkRegisterLinearizability([]).result).toBe('linearizable')
    expect(
      checkRegisterLinearizability([w(0, 1, 1), r(2, 3, 1), w(4, 5, 2), r(6, 7, 2)]).result
    ).toBe('linearizable')
  })

  it('accepts a read of the initial value before any write takes effect', () => {
    expect(checkRegisterLinearizability([r(0, 1, 0), w(2, 3, 1)]).result).toBe('linearizable')
  })

  it('accepts a read concurrent with a write returning either the old or the new value', () => {
    expect(checkRegisterLinearizability([w(0, 10, 1), r(2, 4, 0)]).result).toBe('linearizable')
    expect(checkRegisterLinearizability([w(0, 10, 1), r(2, 4, 1)]).result).toBe('linearizable')
  })

  it('accepts concurrent writes ordered by what later reads saw', () => {
    // w1 and w2 overlap, so w2-then-w1 is a legal order and both later reads see 1.
    expect(
      checkRegisterLinearizability([w(0, 5, 1), w(1, 6, 2), r(7, 8, 1), r(9, 10, 1)]).result
    ).toBe('linearizable')
  })

  it('accepts an open-ended write (committed, outcome unknown) taking effect late', () => {
    expect(checkRegisterLinearizability([w(0, Infinity, 1), r(5, 6, 0), r(7, 8, 1)]).result).toBe(
      'linearizable'
    )
  })

  it('rejects a stale read: a read invoked after a write completed returns the old value', () => {
    expect(checkRegisterLinearizability([w(0, 1, 1), r(2, 3, 0)]).result).toBe('violation')
  })

  it('rejects a read going back in time (new then old, sequential reads)', () => {
    expect(
      checkRegisterLinearizability([w(0, 1, 1), w(2, 10, 2), r(3, 4, 2), r(5, 6, 1)]).result
    ).toBe('violation')
  })

  it('rejects two concurrent readers that disagree on the order of two writes', () => {
    // After both writes finish, one client sees 1 then 2, another sees 2 then 1.
    expect(
      checkRegisterLinearizability([
        w(0, 2, 1),
        w(0, 2, 2),
        r(3, 4, 1),
        r(5, 6, 2),
        r(3, 4, 2),
        r(5, 6, 1)
      ]).result
    ).toBe('violation')
  })

  it('rejects a read of a value nobody wrote', () => {
    expect(checkRegisterLinearizability([w(0, 1, 1), r(2, 3, 7)]).result).toBe('violation')
  })

  it('reports inconclusive, never linearizable, when the search budget runs out', () => {
    // Many fully concurrent writes plus an impossible read sequence forces a wide search.
    const ops: RegisterOperation[] = []
    for (let i = 1; i <= 8; i += 1) ops.push(w(0, 100, i))
    ops.push(r(101, 102, 1), r(103, 104, 2))
    const check = checkRegisterLinearizability(ops, 0, 50)
    expect(check.result).toBe('inconclusive')
    expect(checkRegisterLinearizability(ops).result).toBe('violation')
  })
})
