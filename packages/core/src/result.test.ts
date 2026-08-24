import { describe, expect, it, vi } from 'vitest'
import { err, flatMap, isErr, isOk, map, ok, unwrapOr, type Result } from './result.js'

describe('Result', () => {
  it('distinguishes success from failure', () => {
    const success: Result<number, string> = ok(42)
    const failure: Result<number, string> = err('boom')

    expect(isOk(success)).toBe(true)
    expect(isErr(success)).toBe(false)
    expect(isOk(failure)).toBe(false)
    expect(isErr(failure)).toBe(true)
  })

  it('maps over a success value', () => {
    const result = map(ok(2), (n) => n * 3)
    expect(result).toEqual({ ok: true, value: 6 })
  })

  it('does not run the mapper for a failure', () => {
    const mapper = vi.fn((n: number) => n * 3)
    const result = map(err<string>('nope') as Result<number, string>, mapper)

    expect(mapper).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'nope' })
  })

  it('short-circuits a chain at the first failure', () => {
    const stopped: Result<number, string> = err('stop')
    const second = vi.fn((n: number): Result<number, string> => ok(n + 1))
    // Explicit type arguments: inferring U out of the Result union is ambiguous.
    const chained = flatMap<number, string, number>(
      flatMap<number, string, number>(ok(1), () => stopped),
      second,
    )

    expect(second).not.toHaveBeenCalled()
    expect(chained).toEqual({ ok: false, error: 'stop' })
  })

  it('unwraps with a fallback only for failures', () => {
    expect(unwrapOr(ok(7) as Result<number, string>, 0)).toBe(7)
    expect(unwrapOr(err('missing') as Result<number, string>, 0)).toBe(0)
  })
})
