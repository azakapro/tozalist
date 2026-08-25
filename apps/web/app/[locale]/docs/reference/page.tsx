import { notFound } from 'next/navigation'
import { isLocale, LOCALES } from '../../../../lib/messages'
import {
  listOperations,
  loadOpenApiDocument,
  type OperationEntry,
  type SchemaObject,
} from '../../../../lib/openapi'
import { PageShell } from '../../../../lib/page-shell'

export const dynamic = 'force-static'
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-800',
  POST: 'bg-sky-100 text-sky-800',
  DELETE: 'bg-rose-100 text-rose-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-amber-100 text-amber-800',
}

function SchemaBlock({ title, schema }: { title: string; schema: SchemaObject }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-slate-500">{title}</summary>
      <pre className="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
        {JSON.stringify(schema, null, 2)}
      </pre>
    </details>
  )
}

function Operation({ op }: { op: OperationEntry }) {
  return (
    <section id={op.operationId} className="border-t border-slate-200 py-6">
      <h3 className="flex flex-wrap items-center gap-2 font-mono text-sm">
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold ${METHOD_STYLES[op.method] ?? 'bg-slate-100 text-slate-700'}`}
        >
          {op.method}
        </span>
        <span>{op.path}</span>
        {op.authenticated ? (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            Bearer API key
          </span>
        ) : null}
      </h3>
      {op.summary ? <p className="mt-2 font-medium">{op.summary}</p> : null}
      {op.description ? <p className="mt-1 text-sm text-slate-600">{op.description}</p> : null}
      {op.parameters.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left">
                  Parameter
                </th>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left">In</th>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left">
                  Required
                </th>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {op.parameters.map((param) => (
                <tr key={`${param.in}:${param.name}`}>
                  <td className="border border-slate-200 px-2 py-1 font-mono text-xs">
                    {param.name}
                  </td>
                  <td className="border border-slate-200 px-2 py-1">{param.in}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    {param.required ? 'yes' : 'no'}
                  </td>
                  <td className="border border-slate-200 px-2 py-1">{param.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {op.requestExample !== undefined ? (
        <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
          {JSON.stringify(op.requestExample, null, 2)}
        </pre>
      ) : null}
      {op.requestBody ? <SchemaBlock title="Request body schema" schema={op.requestBody} /> : null}
      <div className="mt-3 space-y-2">
        {op.responses.map((response) => (
          <div key={response.status} className="text-sm">
            <span className="font-mono font-semibold">{response.status}</span>
            {response.description ? (
              <span className="text-slate-600"> — {response.description}</span>
            ) : null}
            {response.schema ? (
              <SchemaBlock title="Response schema" schema={response.schema} />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function ReferencePage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const doc = loadOpenApiDocument()
  const operations = listOperations(doc)
  const tags = [...new Set(operations.map((op) => op.tag))]
  return (
    <PageShell locale={params.locale}>
      <h1 className="mb-2 pt-4 text-2xl font-bold">API reference</h1>
      <p className="mb-1 text-sm text-slate-600">
        Generated at build time from the same OpenAPI {doc.openapi} document the API serves at{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/openapi.json</code> — version{' '}
        {doc.info.version}.
      </p>
      <p className="mb-6 text-sm text-slate-600">
        All authenticated endpoints expect{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
          Authorization: Bearer tzl_live_…
        </code>
        . Errors always use the envelope{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
          {'{ error: { code, message, request_id } }'}
        </code>
        .
      </p>
      {tags.map((tag) => (
        <div key={tag} className="mb-4">
          <h2 className="text-lg font-semibold">{tag}</h2>
          {operations
            .filter((op) => op.tag === tag)
            .map((op) => (
              <Operation key={`${op.method} ${op.path}`} op={op} />
            ))}
        </div>
      ))}
    </PageShell>
  )
}
