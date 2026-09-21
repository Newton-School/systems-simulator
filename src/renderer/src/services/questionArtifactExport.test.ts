import { describe, expect, it, vi } from 'vitest'
import { deserializeQuestionAuthoringExportBundle } from '../../../engine/analysis/questionAuthoringExportBundle'
import { createQuestionAuthoringProject } from '../../../engine/analysis/questionAuthoringProject'
import type { IFileService } from './FileService.types'
import { downloadQuestionAuthoringArtifacts } from './questionArtifactExport'

function completeProject() {
  return createQuestionAuthoringProject({
    projectId: 'project-export',
    updatedAt: '2026-09-19T12:00:00.000Z',
    title: 'Design a Durable Queue',
    problemStatement: 'Keep accepted messages durable during worker restarts.',
    scenarios: [
      {
        id: 'baseline',
        description: 'Sustain steady traffic.',
        seed: 'baseline-v1',
        pattern: 'constant',
        durationSeconds: 60,
        warmupSeconds: 5,
        baseRps: 1000,
        readPercent: 80,
        requestSizeBytes: 512
      }
    ],
    metricRules: [
      {
        id: 'metric-target',
        metric: 'latency_p99',
        operator: '<',
        value: 100,
        unit: 'ms'
      }
    ]
  })
}

describe('Question Studio artifact download', () => {
  it('saves a validated bundle as a new file without replacing the active project handle', async () => {
    let savedContent = ''
    const fileService: IFileService = {
      save: vi.fn(async (content, suggestedName) => {
        savedContent = content
        return { name: suggestedName ?? 'bundle.json' }
      }),
      load: vi.fn(async () => null)
    }

    const result = await downloadQuestionAuthoringArtifacts(completeProject(), fileService)

    expect(result.status).toBe('downloaded')
    expect(deserializeQuestionAuthoringExportBundle(savedContent).authoringProject).toEqual(
      completeProject()
    )
    expect(fileService.save).toHaveBeenCalledWith(
      expect.stringContaining('"artifact": "dsds-question-export-bundle"'),
      'design-a-durable-queue.dsds-question-export-bundle.json',
      expect.objectContaining({ saveAsNewFile: true })
    )
  })

  it('does not open a save dialog for an incomplete draft', async () => {
    const fileService: IFileService = {
      save: vi.fn(async () => null),
      load: vi.fn(async () => null)
    }

    await expect(
      downloadQuestionAuthoringArtifacts(createQuestionAuthoringProject(), fileService)
    ).resolves.toEqual({
      status: 'blocked',
      message: 'Complete the generated-output checklist before downloading artifacts.'
    })
    expect(fileService.save).not.toHaveBeenCalled()
  })
})
