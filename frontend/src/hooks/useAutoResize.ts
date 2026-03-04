import { useCallback, useEffect, useRef } from 'react'

/**
 * textarea 自动高度调整 Hook
 *
 * 监听 value 变化，自动调整 textarea 高度。
 * 超过 maxRows 行时启用滚动。
 *
 * @param value - 当前文本内容
 * @param maxRows - 最大可见行数（默认 8）
 */
export function useAutoResize(
  value: string,
  maxRows = 8,
  onLayoutChange?: (state: { multiline: boolean; overflowing: boolean }) => void,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 获取行高（从 computed style 解析）
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24
    const maxHeight = lineHeight * maxRows

    // 先收缩到一行，再用 scrollHeight 算出实际内容高度
    el.style.height = 'auto'
    const style = getComputedStyle(el)
    const paddingTop = parseFloat(style.paddingTop) || 0
    const paddingBottom = parseFloat(style.paddingBottom) || 0
    const singleLineHeight = lineHeight + paddingTop + paddingBottom

    const scrollHeight = el.scrollHeight
    const nextHeight = Math.min(scrollHeight, maxHeight)

    el.style.height = `${nextHeight}px`
    const overflowing = scrollHeight > maxHeight
    el.style.overflowY = overflowing ? 'auto' : 'hidden'

    if (onLayoutChange) {
      const multiline = value.trim().length > 0 && scrollHeight > singleLineHeight + 1
      onLayoutChange({ multiline, overflowing })
    }
  }, [maxRows, onLayoutChange, value])

  useEffect(() => {
    resize()
  }, [value, resize])

  return textareaRef
}
