/**
 * FIFO wait queues keyed by a resource id, shared by every edge resource that
 * makes a request wait for a free unit: the connection model's pool streams
 * (connectionPool.ts) and the edge in-flight slots of `maxConcurrentRequests`.
 *
 * The behaviour is the one a client connection pool has: a request that finds
 * the resource exhausted waits in line, oldest first, until a unit frees or its
 * own deadline passes (the pool's acquire timeout). The queue itself has no
 * length bound; each waiter's deadline bounds how long it stays.
 *
 * Removal of a waiter whose deadline fired is by predicate (rare, and the
 * timed-out waiter is usually near the head, since deadlines follow arrival
 * order). Taking from the head is O(1) amortised.
 */
export class KeyedWaitQueue<W> {
  private readonly queues = new Map<string, { items: W[]; head: number }>()

  private queue(key: string): { items: W[]; head: number } {
    let queue = this.queues.get(key)
    if (!queue) {
      queue = { items: [], head: 0 }
      this.queues.set(key, queue)
    }
    return queue
  }

  /** Waiters currently queued under `key`. */
  size(key: string): number {
    const queue = this.queues.get(key)
    return queue ? queue.items.length - queue.head : 0
  }

  /** Join the back of the line, or the front when a waiter is put back (`front`). */
  enqueue(key: string, waiter: W, front = false): void {
    const queue = this.queue(key)
    if (!front) {
      queue.items.push(waiter)
    } else if (queue.head > 0) {
      queue.head -= 1
      queue.items[queue.head] = waiter
    } else {
      queue.items.unshift(waiter)
    }
  }

  /** The oldest waiter under `key` (next to be served), without removing it. */
  first(key: string): W | undefined {
    const queue = this.queues.get(key)
    return queue && queue.items.length > queue.head ? queue.items[queue.head] : undefined
  }

  /** The newest waiter under `key`, without removing it. */
  peekLast(key: string): W | undefined {
    const queue = this.queues.get(key)
    return queue && queue.items.length > queue.head
      ? queue.items[queue.items.length - 1]
      : undefined
  }

  /** The first waiter matching `predicate`, without removing it. */
  find(key: string, predicate: (waiter: W) => boolean): W | undefined {
    const queue = this.queues.get(key)
    if (!queue) return undefined
    for (let index = queue.head; index < queue.items.length; index += 1) {
      if (predicate(queue.items[index])) return queue.items[index]
    }
    return undefined
  }

  /** Remove the first waiter matching `predicate`. Returns whether one was waiting. */
  remove(key: string, predicate: (waiter: W) => boolean): boolean {
    const queue = this.queues.get(key)
    if (!queue) return false
    for (let index = queue.head; index < queue.items.length; index += 1) {
      if (predicate(queue.items[index])) {
        queue.items.splice(index, 1)
        this.compact(key, queue)
        return true
      }
    }
    return false
  }

  /** Take up to `count` waiters from the front of the line, oldest first. */
  take(key: string, count: number): W[] {
    const queue = this.queues.get(key)
    if (!queue || count <= 0) return []
    const end = Math.min(queue.items.length, queue.head + count)
    const taken = queue.items.slice(queue.head, end)
    queue.head = end
    this.compact(key, queue)
    return taken
  }

  private compact(key: string, queue: { items: W[]; head: number }): void {
    if (queue.head >= queue.items.length) {
      this.queues.delete(key)
      return
    }
    // Drop the consumed prefix once it dominates, so memory follows the live line.
    if (queue.head > 1024 && queue.head * 2 > queue.items.length) {
      queue.items = queue.items.slice(queue.head)
      queue.head = 0
    }
  }
}
