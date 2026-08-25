import type { MDXComponents } from 'mdx/types'

/** Styles MDX legal/docs content without any client JS. */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => <h1 className="mb-4 text-2xl font-bold" {...props} />,
    h2: (props) => <h2 className="mb-2 mt-8 text-xl font-semibold" {...props} />,
    h3: (props) => <h3 className="mb-2 mt-6 font-semibold" {...props} />,
    p: (props) => <p className="mb-3 leading-relaxed text-slate-700" {...props} />,
    ul: (props) => <ul className="mb-4 list-disc space-y-1 pl-6 text-slate-700" {...props} />,
    ol: (props) => <ol className="mb-4 list-decimal space-y-1 pl-6 text-slate-700" {...props} />,
    li: (props) => <li className="leading-relaxed" {...props} />,
    table: (props) => (
      <div className="mb-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...props} />
      </div>
    ),
    th: (props) => (
      <th
        className="border border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold"
        {...props}
      />
    ),
    td: (props) => <td className="border border-slate-200 px-3 py-2 align-top" {...props} />,
    code: (props) => (
      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm" {...props} />
    ),
    pre: (props) => (
      <pre
        className="mb-4 overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-sm text-slate-100"
        {...props}
      />
    ),
    a: (props) => <a className="text-slate-900 underline" {...props} />,
    ...components,
  }
}
