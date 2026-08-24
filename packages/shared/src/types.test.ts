import { describe, expect, it } from 'vitest'
import { SERVICE_NAMES } from './constants.js'
import { isInternalOnlyService, isServiceName } from './types.js'

describe('isServiceName', () => {
  it('accepts every declared service name', () => {
    for (const name of SERVICE_NAMES) {
      expect(isServiceName(name)).toBe(true)
    }
  })

  it('rejects names that are not services', () => {
    expect(isServiceName('billing')).toBe(false)
    expect(isServiceName('')).toBe(false)
    expect(isServiceName('API')).toBe(false)
  })
})

describe('isInternalOnlyService', () => {
  it('marks the engine as internal only', () => {
    expect(isInternalOnlyService('engine')).toBe(true)
  })

  it('does not mark public-facing services as internal only', () => {
    expect(isInternalOnlyService('api')).toBe(false)
    expect(isInternalOnlyService('web')).toBe(false)
    expect(isInternalOnlyService('dashboard')).toBe(false)
  })
})

describe('SERVICE_NAMES', () => {
  it('has no duplicates', () => {
    expect(new Set(SERVICE_NAMES).size).toBe(SERVICE_NAMES.length)
  })
})
