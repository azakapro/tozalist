// Type shim for build-time MDX imports (@next/mdx compiles these to components).
declare module '*.mdx' {
  import type { ComponentType } from 'react'
  const Content: ComponentType
  export default Content
}
