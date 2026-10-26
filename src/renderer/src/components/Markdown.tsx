import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { memo, useMemo, type MouseEvent } from 'react'
import { api, copyText } from '../util'

marked.setOptions({ gfm: true, breaks: false })

const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const label = (lang ?? '').split(/\s/)[0]
  return `<div class="codeblock"><div class="codeblock-head"><span>${label || 'kod'}</span><button class="codeblock-copy" data-copy>Kopyala</button></div><pre><code>${esc}</code></pre></div>`
}

/** Model çıktısını güvenli şekilde (DOMPurify) markdown olarak gösterir. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { renderer, async: false }) as string), [text])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.matches('[data-copy]')) {
      const code = target.closest('.codeblock')?.querySelector('code')?.textContent ?? ''
      copyText(code)
      target.textContent = 'Kopyalandı'
      setTimeout(() => (target.textContent = 'Kopyala'), 1200)
      return
    }
    const a = target.closest('a')
    if (a?.href) {
      e.preventDefault()
      void api.openExternal(a.href)
    }
  }

  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
})
