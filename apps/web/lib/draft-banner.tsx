import { LEGAL_PAGES_DRAFT } from './site-config'

/** The single legal-review banner, controlled by one flag in site-config. */
export function DraftBanner() {
  if (!LEGAL_PAGES_DRAFT) return null
  return (
    <div
      data-testid="draft-banner"
      role="status"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
    >
      DRAFT — pending legal review. This document is a working draft and has not yet been approved
      by counsel.
    </div>
  )
}
