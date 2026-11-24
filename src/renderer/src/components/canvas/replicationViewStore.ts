import { create } from 'zustand'

export interface ReplicationViewState {
  /** Show every caller→follower read path instead of the collapsed cluster view. */
  routing: boolean
  /** Show the leader→follower replication links. */
  replication: boolean
  /** Show lag / synced chips on followers. */
  lag: boolean
  /** Show the moving request packets on edges. */
  animation: boolean
  toggle: (key: 'routing' | 'replication' | 'lag' | 'animation') => void
}

/** Display-only canvas preferences for replication groups; never saved or graded. */
export const useReplicationView = create<ReplicationViewState>((set) => ({
  routing: false,
  replication: true,
  lag: true,
  animation: true,
  toggle: (key) => set((state) => ({ [key]: !state[key] }) as Partial<ReplicationViewState>)
}))
