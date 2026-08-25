import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'TozaList',
  description: 'Email list hygiene for Uzbekistan.',
}

// System font stack only: no external font CDN, nothing to download.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
