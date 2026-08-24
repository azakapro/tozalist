import { describe, expect, it } from 'vitest'
import { DEFAULT_API_PORT, readApiConfig } from './config.js'

describe('readApiConfig', () => {
  it('defaults to port 3001 when API_PORT is absent', () => {
    expect(readApiConfig({}).port).toBe(DEFAULT_API_PORT)
    expect(readApiConfig({ API_PORT: '' }).port).toBe(DEFAULT_API_PORT)
  })

  it('uses API_PORT when it is a valid port number', () => {
    expect(readApiConfig({ API_PORT: '8080' }).port).toBe(8080)
  })

  it('rejects values that are not usable ports', () => {
    expect(() => readApiConfig({ API_PORT: 'http' })).toThrow(/API_PORT/)
    expect(() => readApiConfig({ API_PORT: '0' })).toThrow(/API_PORT/)
    expect(() => readApiConfig({ API_PORT: '70000' })).toThrow(/API_PORT/)
    expect(() => readApiConfig({ API_PORT: '3001.5' })).toThrow(/API_PORT/)
  })
})
