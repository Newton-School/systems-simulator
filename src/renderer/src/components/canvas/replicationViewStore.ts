import { create } from 'zustand'

export interface ReplicationViewState {
  /** Show every caller→follower read path instead of the collapsed cluster view. */
  routing: boolean
  /** Show the leader→follower replication links. */
  replication: boolean
  /** Show lag / synced chips on followers. */
  lag: boolean
  toggle: (key: 'routing' | 'replication' | 'lag') => void
}

/** Display-only canvas preferences for replication groups; never saved or graded. */
export const useReplicationView = create<ReplicationViewState>((set) => ({
  routing: false,
  replication: true,
  lag: true,
  toggle: (key) => set((state) => ({ [key]: !state[key] }) as Partial<ReplicationViewState>)
}))
