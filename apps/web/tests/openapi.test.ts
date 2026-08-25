import { describe, expect, it } from 'vitest'
import { inlineRefs, listOperations } from '../lib/openapi'

const DOC = {
  openapi: '3.1.0',
  info: { title: 'x', version: '0.0.0' },
  components: {
    schemas: {
      'def-0': { type: 'object', properties: { code: { type: 'string' } } },
    },
  },
  paths: {
    '/v1/things/{id}': {
      get: {
        operationId: 'getThing',
        summary: 'Get one thing',
        tags: ['Things'],
        security: [{ bearerApiKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/def-0' },
              },
            },
          },
        },
      },
    },
  },
}

describe('openapi renderer', () => {
  it('flattens operations and inlines schema refs', () => {
    const ops = listOperations(DOC as never)
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op).toMatchObject({
      method: 'GET',
      path: '/v1/things/{id}',
      tag: 'Things',
      authenticated: true,
    })
    expect(op?.parameters[0]?.name).toBe('id')
    // The $ref was replaced by the actual schema, so the page can print it.
    expect(op?.responses[0]?.schema).toEqual({
      type: 'object',
      properties: { code: { type: 'string' } },
    })
  })

  it('survives an unresolvable ref without crashing the build', () => {
    const node = { $ref: '#/components/schemas/missing' }
    expect(inlineRefs(node, {})).toEqual(node)
  })
})
