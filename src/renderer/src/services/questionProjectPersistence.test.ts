import { describe, expect, it, vi } from 'vitest'
import { createQuestionAuthoringProject } from '../../../engine/analysis/questionAuthoringProject'
import type { IFileService } from './FileService.types'
import {
  openQuestionAuthoringProject,
  saveQuestionAuthoringProject
} from './questionProjectPersistence'

const FIXED_TIME = '2026-09-18T12:00:00.000Z'

describe('Question Studio project file persistence', () => {
  it('round-trips a project through the shared file-service contract', async () => {
    let savedContent = ''
    const fileService: IFileService = {
      save: vi.fn(async (content, suggestedName) => {
        savedContent = content
        return { name: suggestedName ?? 'project.json' }
      }),
      load: vi.fn(async () => ({
        name: 'design-a-cache.simulator-question-project.json',
        content: savedContent
      }))
    }
    const project = createQuestionAuthoringProject({
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      title: 'Design a Cache',
      problemStatement: 'Keep popular reads away from the primary database.',
      functionalRequirements: [{ id: 'fr-cache-hit', text: 'Serve repeated reads from the cache' }],
      nonFunctionalRequirements: [
        {
          id: 'nfr-latency',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ],
      scenarios: [
        {
          id: 'baseline',
          description: 'Exercise steady read traffic.',
          seed: 'cache-baseline-v1',
          pattern: 'constant',
          durationSeconds: 60,
          warmupSeconds: 5,
          baseRps: 1000,
          readPercent: 90,
          requestSizeBytes: 512
        }
      ],
      structuralRules: [{ id: 'single-source', kind: 'requires_single_source' }],
      metricRules: [
        {
          id: 'metric-target',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ],
      activeStage: 'brief'
    })

    const saveResult = await saveQuestionAuthoringProject(project, fileService)
    const openResult = await openQuestionAuthoringProject(fileService)

    expect(saveResult).toEqual({
      status: 'saved',
      fileName: 'design-a-cache.simulator-question-project.json'
    })
    expect(openResult).toEqual({
      status: 'opened',
      fileName: 'design-a-cache.simulator-question-project.json',
      project
    })
    expect(fileService.save).toHaveBeenCalledWith(
      expect.stringContaining('"artifact": "dsds-question-project"'),
      'design-a-cache.simulator-question-project.json',
      expect.objectContaining({ dialogTitle: 'Save Question Studio Project' })
    )
  })

  it('treats a closed picker as cancellation', async () => {
    const fileService: IFileService = {
      save: vi.fn(async () => null),
      load: vi.fn(async () => null)
    }

    await expect(
      saveQuestionAuthoringProject(
        createQuestionAuthoringProject({ projectId: 'project-1', updatedAt: FIXED_TIME }),
        fileService
      )
    ).resolves.toEqual({ status: 'cancelled' })
    await expect(openQuestionAuthoringProject(fileService)).resolves.toEqual({
      status: 'cancelled'
    })
  })

  it('rejects malformed or unrelated JSON without replacing the draft', async () => {
    const forgetMalformedFile = vi.fn()
    const malformed: IFileService = {
      save: vi.fn(async () => null),
      load: vi.fn(async () => ({ name: 'broken.json', content: '{broken' })),
      forgetActiveFile: forgetMalformedFile
    }
    const unrelated: IFileService = {
      save: vi.fn(async () => null),
      load: vi.fn(async () => ({ name: 'question.json', content: '{"version":"1.0"}' }))
    }

    await expect(openQuestionAuthoringProject(malformed)).resolves.toEqual({
      status: 'error',
      message: 'The selected file is not valid JSON.'
    })
    expect(forgetMalformedFile).toHaveBeenCalledTimes(1)
    await expect(openQuestionAuthoringProject(unrelated)).resolves.toEqual({
      status: 'error',
      message:
        'The selected file is not a valid Question Studio project, question package, export bundle, or Newton row seed.'
    })
  })
})
