// Shared command layer for the in-app terminal and `sim shell`. Pure TypeScript
// over a TopologyJSON / SimulationOutput: no DOM, no Node built-ins.

export * from './types'
export * from './context'
export * from './parser'
export * from './registry'
export * from './session'
export { fieldKeysFor } from './commands/config'
export { runSummaryLines, shortestPath } from './commands/topology'
export { diffTopologyConfig, flattenConfig } from './configDump'
export { createStaticDeps, type StaticDepsOptions } from './staticDeps'
