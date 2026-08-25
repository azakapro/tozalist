import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Minimal, dependency-free OpenAPI 3.1 reader for the docs site. The document
 * is exported at BUILD time by the API package's `export-openapi` script
 * (wired into this app's prebuild), so the reference can never drift from the
 * registry that also serves /openapi.json.
 */

export type SchemaObject = { [key: string]: unknown }

export interface ParameterObject {
  name: string
  in: string
  required?: boolean | undefined
  description?: string | undefined
  schema?: SchemaObject | undefined
}

export interface OperationEntry {
  method: string
  path: string
  operationId?: string | undefined
  summary?: string | undefined
  description?: string | undefined
  tag: string
  authenticated: boolean
  parameters: ParameterObject[]
  requestBody?: SchemaObject | undefined
  requestExample?: unknown
  responses: Array<{
    status: string
    description?: string | undefined
    schema?: SchemaObject | undefined
  }>
}

interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string | undefined }
  paths: Record<string, Record<string, SchemaObject>>
  components?: { schemas?: Record<string, SchemaObject> }
  tags?: Array<{ name: string; description?: string }>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recursively inlines #/components/schemas refs, with a depth cap for safety. */
export function inlineRefs(
  node: unknown,
  schemas: Record<string, SchemaObject>,
  depth = 0,
): unknown {
  if (depth > 20) return node
  if (Array.isArray(node)) return node.map((item) => inlineRefs(item, schemas, depth + 1))
  if (!isRecord(node)) return node
  const ref = node['$ref']
  if (typeof ref === 'string') {
    const name = ref.replace('#/components/schemas/', '')
    const resolved = schemas[name]
    if (resolved) return inlineRefs(resolved, schemas, depth + 1)
    return node
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = inlineRefs(value, schemas, depth + 1)
  }
  return out
}

export function loadOpenApiDocument(): OpenApiDocument {
  const raw = readFileSync(join(process.cwd(), 'generated', 'openapi.json'), 'utf8')
  return JSON.parse(raw) as OpenApiDocument
}

/** Flattens the document into render-ready operations, refs inlined. */
export function listOperations(doc: OpenApiDocument): OperationEntry[] {
  const schemas = doc.components?.schemas ?? {}
  const entries: OperationEntry[] = []
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op = methods[method]
      if (!isRecord(op)) continue
      const security = Array.isArray(op.security) ? op.security : []
      const tags = Array.isArray(op.tags) ? op.tags : []
      const requestBody = isRecord(op.requestBody) ? op.requestBody : undefined
      const jsonBody = isRecord(requestBody?.content)
        ? (requestBody.content as Record<string, unknown>)['application/json']
        : undefined
      const bodySchema = isRecord(jsonBody) ? jsonBody.schema : undefined
      const bodyExample = isRecord(jsonBody) ? jsonBody.example : undefined

      const responses: OperationEntry['responses'] = []
      if (isRecord(op.responses)) {
        for (const [status, response] of Object.entries(op.responses)) {
          if (!isRecord(response)) continue
          const content = isRecord(response.content)
            ? (response.content as Record<string, unknown>)['application/json']
            : undefined
          const schema = isRecord(content) ? content.schema : undefined
          responses.push({
            status,
            description:
              typeof response.description === 'string' ? response.description : undefined,
            schema: isRecord(schema) ? (inlineRefs(schema, schemas) as SchemaObject) : undefined,
          })
        }
      }

      entries.push({
        method: method.toUpperCase(),
        path,
        operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
        summary: typeof op.summary === 'string' ? op.summary : undefined,
        description: typeof op.description === 'string' ? op.description : undefined,
        tag: typeof tags[0] === 'string' ? tags[0] : 'Other',
        authenticated: security.length > 0,
        parameters: Array.isArray(op.parameters)
          ? (inlineRefs(op.parameters, schemas) as ParameterObject[])
          : [],
        requestBody: isRecord(bodySchema)
          ? (inlineRefs(bodySchema, schemas) as SchemaObject)
          : undefined,
        requestExample: bodyExample,
        responses,
      })
    }
  }
  return entries
}
