import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { ArtifactTraceItem } from '@webclaw/shared'
import { formatArtifactTraceSummary } from '../../lib/artifacts'

interface ArtifactTraceProps {
  items: ArtifactTraceItem[]
}

export function ArtifactTrace({ items }: ArtifactTraceProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  if (items.length === 0) return null

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-secondary"
        aria-expanded={isExpanded}
      >
        <span className="truncate">{formatArtifactTraceSummary(items)}</span>
        {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-3 rounded-2xl border border-border/70 bg-surface px-4 py-3">
          {items.map((item) => (
            <div key={item.traceId} className="border-l border-border pl-3">
              <div className="text-sm font-medium text-text-primary">{item.title}</div>
              <div className="mt-1 text-xs text-text-muted">
                {item.subtitle}
                {item.detail ? ` · ${item.detail}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
