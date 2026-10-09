import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useStore from '@renderer/store/useStore'
import {
  builderPolicyContext,
  type BuilderPolicyContext
} from '@renderer/utils/builderPolicyContext'
import {
  evaluateBuilderPolicy,
  type BuilderPolicyViolation
} from '../../../engine/analysis/builderPolicy'

/** The active question's builder policy, lock state and created definitions. */
export function useBuilderPolicy(): BuilderPolicyContext & {
  violations: BuilderPolicyViolation[]
} {
  const slice = useStore(
    useShallow((state) => ({
      activeQuestion: state.activeQuestion,
      attemptState: state.attemptState,
      scaffoldNodeIds: state.scaffoldNodeIds,
      questionRunCount: state.questionRunCount,
      nodes: state.nodes
    }))
  )
  return useMemo(() => {
    const context = builderPolicyContext(slice)
    return {
      ...context,
      violations: context.restrictive ? evaluateBuilderPolicy(context.policy, context.entries) : []
    }
  }, [slice])
}
