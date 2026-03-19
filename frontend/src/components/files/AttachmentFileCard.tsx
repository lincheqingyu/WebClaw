import { FileText } from 'lucide-react'
import type { ChatFileAttachment } from '@webclaw/shared'
import { FileCardShell } from './FileCardShell'

interface AttachmentFileCardProps {
  attachment: ChatFileAttachment
  active?: boolean
  onOpen?: () => void
}

function formatAttachmentMeta(attachment: ChatFileAttachment): string {
  const sizeLabel = attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : '文本'
  if (attachment.truncated) {
    return `${attachment.mimeType} · ${sizeLabel} · 已截断`
  }
  return `${attachment.mimeType} · ${sizeLabel}`
}

export function AttachmentFileCard({ attachment, active = false, onOpen }: AttachmentFileCardProps) {
  return (
    <FileCardShell
      title={attachment.name}
      meta={formatAttachmentMeta(attachment)}
      icon={<FileText className="size-4" />}
      active={active}
      onClick={onOpen}
      className="max-w-[22rem] bg-surface-thought dark:bg-[rgb(38,38,36)]"
    />
  )
}
