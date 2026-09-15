import { describe, expect, it } from 'vitest'
import {
  CLOUD_REGION_CATALOGUE,
  cloudRegionsForProvider,
  findCloudRegion,
  LOCATION_CATALOGUE_VERSION
} from './locationCatalog'

describe('location catalogue', () => {
  it('is versioned and has unique provider/code keys', () => {
    const keys = CLOUD_REGION_CATALOGUE.map((entry) => `${entry.provider}:${entry.code}`)
    expect(LOCATION_CATALOGUE_VERSION).toMatch(/^\d{4}-\d{2}$/)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains the complete supported snapshot for each provider', () => {
    expect(cloudRegionsForProvider('aws')).toHaveLength(34)
    expect(cloudRegionsForProvider('gcp')).toHaveLength(44)
    expect(cloudRegionsForProvider('azure')).toHaveLength(58)
    expect(cloudRegionsForProvider('ibm')).toHaveLength(13)
  })

  it('keeps region and zone codes distinct', () => {
    expect(findCloudRegion('aws', 'ap-south-1')?.label).toContain('Mumbai')
    expect(findCloudRegion('ibm', 'us-south')?.label).toBe('Dallas')
    expect(findCloudRegion('ibm', 'us-south-1')).toBeUndefined()
  })
})
