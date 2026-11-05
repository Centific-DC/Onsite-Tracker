import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  FIELD_LABEL, IMAGE_WIDTHS, TAG_STYLE,
  button as buttonBlock, callout, detailsCard, divider, fieldBlock, fieldChip, imageTag, isBlockField, simpleTable,
} from '../../lib/email/blocks.js'
import { HIGHLIGHT_SWATCHES, LIGHT, TEXT_SWATCHES } from '../../lib/email/palette.js'
import { sanitize } from '../../lib/email/render.js'
import { APP_URL } from '../../lib/config.js'
import logoPng from '../../assets/centific-logo.png'
import {
  AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, BulletsIcon, ChevronIcon, ClearIcon, HighlightIcon,
  ImageIcon, ItalicIcon, LinkIcon, NumbersIcon, RedoIcon, StrikeIcon, TextColorIcon, TrashIcon, UnderlineIcon,
  UndoIcon, UnlinkIcon,
} from './ToolbarIcons.jsx'

// The email body editor, carried over from Project Atlas (contenteditable +
// execCommand toolbar): text styles, sizes, colours, alignment, lists, links,
// images, boxes, buttons, tables and Lotus fields. Every change is written as
// inline styles so the email looks the same in Outlook.

const BLOCKS = [
  { id: 'p', label: 'Body text' },
  { id: 'h1', label: 'Title' },
  { id: 'h2', label: 'Section heading' },
  { id: 'h3', label: 'Subheading' },
  { id: 'blockquote', label: 'Quote' },
]
const SIZES = [
  { px: '13px', label: 'Small' },
  { px: '15px', label: 'Normal' },
  { px: '18px', label: 'Large' },
  { px: '24px', label: 'Extra large' },
]
const INSERTS = [
  { id: 'details', label: 'Details card', note: 'Week, lab and shift rows', html: () => detailsCard([['Week', fieldChip('weekRange')], ['Lab', fieldChip('labName')], ['Shifts', fieldChip('shiftCount')]]) },
  { id: 'callout', label: 'Note box', note: 'Coral edge, for reminders', html: () => callout('Important', ['Write your note here.']) },
  { id: 'warning', label: 'Warning box', note: 'Red edge, for changes', html: () => callout('Please note', ['Write your note here.'], 'danger') },
  { id: 'button', label: 'Button', note: 'A link styled as a button', html: () => buttonBlock('Open Lotus clock-in', APP_URL) },
  { id: 'table', label: 'Table', note: '2 columns, 2 rows', html: () => simpleTable(2, 2) },
  { id: 'divider', label: 'Divider line', note: '', html: () => divider() },
]
const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight']
const BLOCK_TAGS = 'p, h1, h2, h3, ul, ol, li, blockquote, table, td, th, hr'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Shrinks an uploaded image so it stays small enough to store and to email. */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode'))
      img.onload = () => {
        const scale = Math.min(1, 1040 / img.naturalWidth)
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas')); return }
        ctx.drawImage(img, 0, 0, w, h)
        const png = file.type === 'image/png' || file.type === 'image/gif'
        resolve({ src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86), width: Math.min(IMAGE_WIDTHS.large, Math.round(w / 2) || w) })
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

const withProtocol = (url) => {
  const v = url.trim()
  if (!v) return ''
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  return `https://${v}`
}

/** A small menu anchored under its toolbar button. Closes on Escape or a click outside. */
function Pop({ open, onClose, wide = false, children, label }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.parentElement?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`em-pop em-raised${wide ? ' em-pop--wide' : ''}`} role="menu" aria-label={label}>
      {children}
    </div>
  )
}

function Tool({ label, on, onRun, children, disabled = false }) {
  return (
    <button
      type="button"
      className={`em-tool${on ? ' is-on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={on === undefined ? undefined : on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  )
}

export default function TemplateEditor({ initialHtml, onChange, fields }) {
  const editorRef = useRef(null)
  const wrapRef = useRef(null)
  const fileRef = useRef(null)
  const rangeRef = useRef(null)
  const [active, setActive] = useState({})
  const [block, setBlock] = useState('p')
  const [open, setOpen] = useState(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [image, setImage] = useState(null)
  const [textColor, setTextColor] = useState(LIGHT.accent)
  const [highlight, setHighlight] = useState(LIGHT.field)

  useLayoutEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml
    // Set once per template; after that the editor owns its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }, [onChange])

  // Remember the last selection inside the editor, so toolbar menus (which take
  // focus) still act on the text that was selected.
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      const ed = editorRef.current
      if (!sel || !sel.rangeCount || !ed || !ed.contains(sel.anchorNode)) return
      rangeRef.current = sel.getRangeAt(0).cloneRange()
      const next = {}
      for (const cmd of STATE_CMDS) {
        try { next[cmd] = document.queryCommandState(cmd) } catch { next[cmd] = false }
      }
      setActive(next)
      let node = sel.anchorNode
      let tag = 'p'
      while (node && node !== ed) {
        const name = node.nodeName?.toLowerCase()
        if (BLOCKS.some((b) => b.id === name)) { tag = name; break }
        node = node.parentNode
      }
      setBlock(tag)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const restore = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    ed.focus({ preventScroll: true })
    const sel = window.getSelection()
    if (!sel) return
    if (rangeRef.current && ed.contains(rangeRef.current.startContainer)) {
      sel.removeAllRanges()
      sel.addRange(rangeRef.current)
    } else if (!sel.rangeCount || !ed.contains(sel.anchorNode)) {
      // Never clicked into the editor yet: work at the end.
      const r = document.createRange()
      r.selectNodeContents(ed)
      r.collapse(false)
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }, [])

  // New tags from the toolbar or a paste get the template's default styles.
  const tidy = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    ed.querySelectorAll(`${BLOCK_TAGS}, a`).forEach((el) => {
      const base = TAG_STYLE[el.tagName.toLowerCase()]
      if (base && !el.getAttribute('style')) el.setAttribute('style', base)
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener') }
    })
    ed.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span')
      span.style.fontSize = 'xxx-large'
      while (f.firstChild) span.appendChild(f.firstChild)
      f.replaceWith(span)
    })
  }, [])

  const run = useCallback((cmd, value = null) => {
    restore()
    document.execCommand('styleWithCSS', false, true)
    document.execCommand(cmd, false, value)
    tidy()
    emit()
  }, [restore, tidy, emit])

  const insertHtml = useCallback((html) => {
    restore()
    document.execCommand('insertHTML', false, html)
    tidy()
    emit()
  }, [restore, tidy, emit])

  // Boxes, buttons and tables go after the selection rather than replacing it.
  const insertBlock = (html) => {
    const r = rangeRef.current
    if (r && editorRef.current?.contains(r.startContainer)) r.collapse(false)
    insertHtml(html)
  }

  const hasSelection = () => Boolean(rangeRef.current && !rangeRef.current.collapsed && editorRef.current?.contains(rangeRef.current.startContainer))

  const setBlockType = (tag) => {
    setOpen(null)
    run('formatBlock', tag)
    // The chosen style wins over whatever the old block carried.
    const sel = window.getSelection()
    let node = sel?.anchorNode ?? null
    while (node && node !== editorRef.current) {
      if (node.nodeName?.toLowerCase() === tag) { node.setAttribute('style', TAG_STYLE[tag]); break }
      node = node.parentNode
    }
    emit()
  }

  const setSize = (px) => {
    setOpen(null)
    if (!hasSelection()) { toast('Select some text first'); return }
    run('fontSize', '7')
    editorRef.current?.querySelectorAll('span').forEach((s) => {
      if (s.style.fontSize === 'xxx-large') s.style.fontSize = px
    })
    emit()
  }

  const paint = (cmd, color) => {
    setOpen(null)
    if (!hasSelection()) { toast('Select some text first'); return }
    run(cmd, color)
  }

  const applyLink = (e) => {
    e?.preventDefault()
    const url = withProtocol(linkUrl)
    setOpen(null)
    if (!url) return
    if (hasSelection()) {
      run('createLink', url)
    } else {
      const text = linkUrl.trim().replace(/^mailto:/i, '')
      insertHtml(`<a href="${url.replace(/"/g, '&quot;')}" style="${TAG_STYLE.a}">${text.replace(/</g, '&lt;')}</a>&nbsp;`)
    }
    setLinkUrl('')
  }

  const openLink = () => {
    let node = rangeRef.current?.startContainer ?? null
    while (node && node !== editorRef.current && node.nodeName !== 'A') node = node.parentNode
    setLinkUrl(node && node.nodeName === 'A' ? node.getAttribute('href') ?? '' : '')
    setOpen(open === 'link' ? null : 'link')
  }

  const addImage = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > MAX_IMAGE_BYTES) { toast.error('That image is over 8 MB. Pick a smaller one.'); return }
    try {
      const { src, width } = await readImage(file)
      insertHtml(imageTag(src, file.name.replace(/\.[^.]+$/, ''), width))
    } catch {
      toast.error('Couldn’t read that image.')
    }
  }

  // Image tools: shown over the clicked image.
  const pickImage = (img) => {
    const wrap = wrapRef.current
    if (!img || !wrap) { setImage(null); return }
    const a = img.getBoundingClientRect()
    const b = wrap.getBoundingClientRect()
    setImage({ el: img, top: a.top - b.top + wrap.scrollTop, left: a.left - b.left })
  }

  const replaceImage = (change) => {
    const img = image?.el
    if (!img || !editorRef.current?.contains(img)) { setImage(null); return }
    const sel = window.getSelection()
    const r = document.createRange()
    r.selectNode(img)
    sel?.removeAllRanges()
    sel?.addRange(r)
    rangeRef.current = r.cloneRange()
    if (change === 'remove') {
      document.execCommand('delete')
    } else {
      const next = img.cloneNode()
      change(next)
      document.execCommand('insertHTML', false, next.outerHTML)
    }
    setImage(null)
    emit()
  }

  const sizeImage = (w) => replaceImage((n) => {
    n.setAttribute('width', String(w))
    n.style.width = `${w}px`
  })
  const alignImage = (where) => replaceImage((n) => {
    n.style.marginLeft = where === 'left' ? '0' : 'auto'
    n.style.marginRight = where === 'right' ? '0' : 'auto'
  })

  const onPaste = (e) => {
    const file = Array.from(e.clipboardData.files ?? []).find((f) => f.type.startsWith('image/'))
    if (file) { e.preventDefault(); void addImage(file); return }
    const html = e.clipboardData.getData('text/html')
    if (html) { e.preventDefault(); insertHtml(sanitize(html)); return }
    const text = e.clipboardData.getData('text/plain')
    if (text) { e.preventDefault(); document.execCommand('insertText', false, text); emit() }
  }

  const onDrop = (e) => {
    const file = Array.from(e.dataTransfer.files ?? []).find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (r) rangeRef.current = r
    void addImage(file)
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink() }
  }

  const toggle = (id) => () => setOpen((o) => (o === id ? null : id))
  const closePop = useCallback(() => setOpen(null), [])
  const blockLabel = BLOCKS.find((b) => b.id === block)?.label ?? 'Body text'

  return (
    <div className="em-editor">
      <div className="em-toolbar em-raised-sm" role="toolbar" aria-label="Formatting">
        <div className="em-group">
          <Tool label="Undo (Ctrl+Z)" onRun={() => run('undo')}><UndoIcon /></Tool>
          <Tool label="Redo (Ctrl+Shift+Z)" onRun={() => run('redo')}><RedoIcon /></Tool>
        </div>

        <div className="em-group">
          <div className="em-anchor">
            <button type="button" className="em-select em-select--block" aria-haspopup="menu" aria-expanded={open === 'block'} onMouseDown={(e) => e.preventDefault()} onClick={toggle('block')}>
              <span>{blockLabel}</span><ChevronIcon />
            </button>
            <Pop open={open === 'block'} onClose={closePop} label="Text style">
              {BLOCKS.map((b) => (
                <button key={b.id} type="button" role="menuitem" className={`em-pop-item em-pop-item--${b.id}${block === b.id ? ' is-on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockType(b.id)}>
                  {b.label}
                </button>
              ))}
            </Pop>
          </div>
          <div className="em-anchor">
            <button type="button" className="em-select em-select--narrow" aria-haspopup="menu" aria-expanded={open === 'size'} title="Text size" onMouseDown={(e) => e.preventDefault()} onClick={toggle('size')}>
              <span>Size</span><ChevronIcon />
            </button>
            <Pop open={open === 'size'} onClose={closePop} label="Text size">
              {SIZES.map((s) => (
                <button key={s.px} type="button" role="menuitem" className="em-pop-item" style={{ fontSize: s.px }} onMouseDown={(e) => e.preventDefault()} onClick={() => setSize(s.px)}>
                  {s.label}
                </button>
              ))}
            </Pop>
          </div>
        </div>

        <div className="em-group">
          <Tool label="Bold (Ctrl+B)" on={!!active.bold} onRun={() => run('bold')}><BoldIcon /></Tool>
          <Tool label="Italic (Ctrl+I)" on={!!active.italic} onRun={() => run('italic')}><ItalicIcon /></Tool>
          <Tool label="Underline (Ctrl+U)" on={!!active.underline} onRun={() => run('underline')}><UnderlineIcon /></Tool>
          <Tool label="Strikethrough" on={!!active.strikeThrough} onRun={() => run('strikeThrough')}><StrikeIcon /></Tool>
          <div className="em-anchor">
            <Tool label="Text colour" onRun={toggle('color')}><TextColorIcon color={textColor} /></Tool>
            <Pop open={open === 'color'} onClose={closePop} label="Text colour">
              <div className="em-swatches">
                {TEXT_SWATCHES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="em-swatch"
                    style={{ background: LIGHT[s.key] }}
                    title={s.label}
                    aria-label={s.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setTextColor(LIGHT[s.key]); paint('foreColor', LIGHT[s.key]) }}
                  />
                ))}
              </div>
              <label className="em-custom">
                <span>Custom</span>
                <input type="color" defaultValue={textColor} onChange={(e) => { setTextColor(e.target.value); paint('foreColor', e.target.value) }} />
              </label>
            </Pop>
          </div>
          <div className="em-anchor">
            <Tool label="Highlight" onRun={toggle('highlight')}><HighlightIcon color={highlight} /></Tool>
            <Pop open={open === 'highlight'} onClose={closePop} label="Highlight">
              <div className="em-swatches">
                {HIGHLIGHT_SWATCHES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="em-swatch"
                    style={{ background: LIGHT[s.key] }}
                    title={s.label}
                    aria-label={s.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setHighlight(LIGHT[s.key]); paint('hiliteColor', LIGHT[s.key]) }}
                  />
                ))}
                <button
                  type="button"
                  className="em-swatch em-swatch--none"
                  title="No highlight"
                  aria-label="No highlight"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => paint('hiliteColor', 'transparent')}
                />
              </div>
            </Pop>
          </div>
        </div>

        <div className="em-group">
          <Tool label="Align left" on={!!active.justifyLeft} onRun={() => run('justifyLeft')}><AlignLeftIcon /></Tool>
          <Tool label="Align centre" on={!!active.justifyCenter} onRun={() => run('justifyCenter')}><AlignCenterIcon /></Tool>
          <Tool label="Align right" on={!!active.justifyRight} onRun={() => run('justifyRight')}><AlignRightIcon /></Tool>
          <Tool label="Bulleted list" on={!!active.insertUnorderedList} onRun={() => run('insertUnorderedList')}><BulletsIcon /></Tool>
          <Tool label="Numbered list" on={!!active.insertOrderedList} onRun={() => run('insertOrderedList')}><NumbersIcon /></Tool>
        </div>

        <div className="em-group">
          <div className="em-anchor">
            <Tool label="Link (Ctrl+K)" onRun={openLink}><LinkIcon /></Tool>
            <Pop open={open === 'link'} onClose={closePop} wide label="Link">
              <form className="em-link" onSubmit={applyLink}>
                <input
                  className="em-input em-link-input"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  placeholder="Web address or email"
                  aria-label="Link address"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-sm em-link-go">Apply</button>
              </form>
            </Pop>
          </div>
          <Tool label="Remove link" onRun={() => run('unlink')}><UnlinkIcon /></Tool>
          <Tool label="Add image" onRun={() => fileRef.current?.click()}><ImageIcon /></Tool>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => { void addImage(e.target.files?.[0]); e.target.value = '' }}
          />
          <div className="em-anchor">
            <button type="button" className="em-select" aria-haspopup="menu" aria-expanded={open === 'insert'} onMouseDown={(e) => e.preventDefault()} onClick={toggle('insert')}>
              <span>Insert</span><ChevronIcon />
            </button>
            <Pop open={open === 'insert'} onClose={closePop} wide label="Insert">
              {INSERTS.map((it) => (
                <button key={it.id} type="button" role="menuitem" className="em-pop-item em-pop-item--two" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(null); insertBlock(it.html()) }}>
                  <span>{it.label}</span>
                  {it.note && <span className="em-pop-note">{it.note}</span>}
                </button>
              ))}
            </Pop>
          </div>
          <div className="em-anchor">
            <button type="button" className="em-select em-select--field" aria-haspopup="menu" aria-expanded={open === 'field'} onMouseDown={(e) => e.preventDefault()} onClick={toggle('field')}>
              <span>Field</span><ChevronIcon />
            </button>
            <Pop open={open === 'field'} onClose={closePop} wide label="Lotus field">
              <p className="em-pop-hint">Filled in for each person when the email is sent.</p>
              {fields.map((id) => (
                <button key={id} type="button" role="menuitem" className="em-pop-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(null); if (isBlockField(id)) insertBlock(fieldBlock(id)); else insertHtml(`${fieldChip(id)}&nbsp;`) }}>
                  <span className="em-chip-sample">{FIELD_LABEL[id]}</span>
                </button>
              ))}
            </Pop>
          </div>
        </div>

        <div className="em-group">
          <Tool label="Clear formatting" onRun={() => run('removeFormat')}><ClearIcon /></Tool>
        </div>
      </div>

      <div ref={wrapRef} className="em-canvas em-well">
        <div className="em-paper">
          <EmailHeader />
          <div className="em-frame">
            <div
              ref={editorRef}
              className="em-body"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Email body"
              spellCheck
              onInput={() => { setImage(null); emit() }}
              onPaste={onPaste}
              onDrop={onDrop}
              onKeyDown={onKeyDown}
              onClick={(e) => pickImage(e.target instanceof HTMLImageElement ? e.target : null)}
            />
          </div>
          <p className="em-foot">© Centific · Project Lotus</p>
        </div>

        {image && (
          <div className="em-imgbar em-raised-sm" style={{ top: image.top, left: image.left }} role="toolbar" aria-label="Image">
            {Object.entries(IMAGE_WIDTHS).map(([id, w]) => (
              <button key={id} type="button" className="em-imgbar-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => sizeImage(w)}>
                {id === 'small' ? 'S' : id === 'medium' ? 'M' : id === 'large' ? 'L' : 'Full'}
              </button>
            ))}
            <span className="em-imgbar-sep" aria-hidden="true" />
            <button type="button" className="em-imgbar-btn" title="Align left" aria-label="Align image left" onMouseDown={(e) => e.preventDefault()} onClick={() => alignImage('left')}><AlignLeftIcon /></button>
            <button type="button" className="em-imgbar-btn" title="Centre" aria-label="Centre image" onMouseDown={(e) => e.preventDefault()} onClick={() => alignImage('center')}><AlignCenterIcon /></button>
            <button type="button" className="em-imgbar-btn" title="Align right" aria-label="Align image right" onMouseDown={(e) => e.preventDefault()} onClick={() => alignImage('right')}><AlignRightIcon /></button>
            <span className="em-imgbar-sep" aria-hidden="true" />
            <button type="button" className="em-imgbar-btn em-imgbar-btn--danger" title="Remove image" aria-label="Remove image" onMouseDown={(e) => e.preventDefault()} onClick={() => replaceImage('remove')}><TrashIcon /></button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The fixed email header, as it looks in light mode (the mode templates are written in). */
export function EmailHeader({ logo = null }) {
  return (
    <div className="em-head">
      <div className="em-brand">
        <span className="em-brand-mark" style={{ WebkitMaskImage: `url(${logo || logoPng})`, maskImage: `url(${logo || logoPng})` }} aria-hidden="true" />
        <span className="em-brand-word">Centific</span>
      </div>
      <span className="em-brand-eyebrow">Project Lotus</span>
    </div>
  )
}
