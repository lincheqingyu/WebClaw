import clsx from 'clsx'

export const INTERACTIVE_HTML_SANDBOX = [
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-same-origin',
  'allow-scripts',
].join(' ')

interface HtmlPreviewFrameProps {
  title: string
  html: string
  resetKey?: number
  className?: string
}

export function HtmlPreviewFrame({ title, html, resetKey = 0, className }: HtmlPreviewFrameProps) {
  return (
    <div className={clsx('min-h-[18rem] flex-1 overflow-hidden bg-surface', className)}>
      <iframe
        key={`${title}:${resetKey}`}
        title={title}
        sandbox={INTERACTIVE_HTML_SANDBOX}
        srcDoc={html}
        className="min-h-0 h-full w-full bg-white"
      />
    </div>
  )
}
