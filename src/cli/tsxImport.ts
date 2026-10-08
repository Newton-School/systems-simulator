import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/**
 * `--import` specifier that loads tsx in a child process. Resolved to an absolute
 * file URL from this checkout so subprocess isolation works when the sim cli runs
 * from any working directory (e.g. a linked `sim` binary); falls back to the bare
 * specifier when resolution is unavailable.
 */
export function tsxImportSpecifier(): string {
  try {
    return pathToFileURL(createRequire(__filename).resolve('tsx')).href
  } catch {
    return 'tsx'
  }
}
