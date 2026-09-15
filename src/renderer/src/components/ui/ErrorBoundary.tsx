import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * What to render when a child throws during render/commit. Receives the error
   * and a `reset` callback that clears the boundary so the subtree remounts.
   */
  fallback: (error: Error, reset: () => void) => ReactNode
  /** Optional label to namespace console errors from this boundary. */
  label?: string
  /** Optional side-effect on catch (telemetry, etc.). */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Isolates a subtree so a render-time exception in one child (e.g. a single edge
 * or node) shows a recoverable fallback instead of blanking the whole app. React
 * error boundaries must be class components — this is the one intentional class.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack in the console for debugging; the UI still recovers.
    console.error(`[${this.props.label ?? 'ErrorBoundary'}] render error:`, error, info)
    this.props.onError?.(error, info)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset)
    }
    return this.props.children
  }
}
