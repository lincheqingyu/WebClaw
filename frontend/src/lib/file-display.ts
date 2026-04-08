import type { GeneratedFileArtifact } from '@lecquy/shared'

export function formatBytes(size?: number): string {
  if (!size) return 'Unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function inferFileExtension(name: string): string {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1) ?? '' : ''
}

export function inferArtifactTypeLabel(artifact: Pick<GeneratedFileArtifact, 'name' | 'mimeType'>): string {
  const extension = inferFileExtension(artifact.name)
  const mime = artifact.mimeType.toLowerCase()

  if (mime.includes('html') || extension === 'html' || extension === 'htm') return 'HTML'
  if (mime.includes('markdown') || extension === 'md' || extension === 'markdown') return 'MD'
  if (mime.includes('json') || extension === 'json') return 'JSON'
  if (mime.includes('python') || extension === 'py') return 'PY'
  if (mime.includes('typescript') || extension === 'ts' || extension === 'tsx') return extension.toUpperCase()
  if (mime.includes('javascript') || extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return extension.toUpperCase()
  if (mime.startsWith('text/') || extension === 'txt') return 'TXT'
  if (extension) return extension.toUpperCase()
  return 'FILE'
}

export function inferArtifactPreviewMode(artifact: Pick<GeneratedFileArtifact, 'name' | 'mimeType'>): 'html' | 'markdown' | 'text' | 'code' {
  const extension = inferFileExtension(artifact.name)
  const mime = artifact.mimeType.toLowerCase()

  if (mime.includes('html') || extension === 'html' || extension === 'htm') return 'html'
  if (mime.includes('markdown') || extension === 'md' || extension === 'markdown') return 'markdown'
  if (mime.startsWith('text/') || ['txt', 'log'].includes(extension)) return 'text'
  return 'code'
}

export function inferCodeLanguage(fileName: string): string {
  const extension = inferFileExtension(fileName)
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'py':
      return 'python'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
    case 'htm':
      return 'html'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sql':
      return 'sql'
    default:
      return extension || 'text'
  }
}
