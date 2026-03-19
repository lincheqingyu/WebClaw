import { startTransition, useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'

interface ShikiCodeViewProps {
  code: string
  language: string
}

export function ShikiCodeView({ code, language }: ShikiCodeViewProps) {
  const [html, setHtml] = useState<string>('')
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    let disposed = false
    setHasError(false)

    startTransition(() => {
      void codeToHtml(code, {
        lang: language,
        theme: 'github-light',
      })
        .then((result) => {
          if (disposed) return
          setHtml(result)
        })
        .catch(() => {
          if (disposed) return
          setHasError(true)
        })
    })

    return () => {
      disposed = true
    }
  }, [code, language])

  if (hasError || !html) {
    return (
      <pre className="min-h-full overflow-x-auto bg-white px-0 py-0 text-[13px] leading-7 text-[#0f172a]">
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="min-h-full overflow-x-auto bg-white [&_.shiki]:!bg-transparent [&_.shiki]:px-0 [&_.shiki]:py-0 [&_.shiki]:text-[13px] [&_.shiki]:leading-7"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
