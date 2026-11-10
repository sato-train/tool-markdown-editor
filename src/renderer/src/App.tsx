import { useCallback, useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

const INITIAL_CONTENT = '# Markdown Editor\n\nMarkdownファイルを開くか、ここから書き始めてください。'
const PANE_ORDER_STORAGE_KEY = 'markdown-editor.panes-reversed'

type FileResult = {
  ok: boolean
  content?: string
  filePath?: string
  error?: string
}

function loadPaneOrder(): boolean {
  try {
    return window.localStorage.getItem(PANE_ORDER_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function App(): React.JSX.Element {
  const [value, setValue] = useState(INITIAL_CONTENT)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorWidth, setEditorWidth] = useState<number | null>(null)
  const [isPaneOrderReversed, setIsPaneOrderReversed] = useState(loadPaneOrder)
  const dirtyRef = useRef(isDirty)
  const workspaceRef = useRef<HTMLElement>(null)

  const togglePaneOrder = useCallback(() => {
    const nextIsPaneOrderReversed = !isPaneOrderReversed
    const workspace = workspaceRef.current
    if (workspace) {
      const { width } = workspace.getBoundingClientRect()
      const minimumPaneWidth = 240
      const dividerWidth = 10
      const maximumWidth = Math.max(minimumPaneWidth, width - minimumPaneWidth - dividerWidth)

      setEditorWidth((currentWidth) => {
        // Keep the divider where it is.  Once the panes exchange columns, the
        // editor occupies the opposite side, so its width must be the remainder.
        const currentEditorWidth = currentWidth ?? width / 2
        const nextWidth = width - dividerWidth - currentEditorWidth
        return Math.min(Math.max(nextWidth, minimumPaneWidth), maximumWidth)
      })
    }

    setIsPaneOrderReversed(nextIsPaneOrderReversed)
    try {
      window.localStorage.setItem(PANE_ORDER_STORAGE_KEY, String(nextIsPaneOrderReversed))
    } catch {
      // The current session remains usable even when settings cannot be saved.
    }
  }, [isPaneOrderReversed])

  const setEditorWidthFromPosition = useCallback((clientX: number) => {
    const workspace = workspaceRef.current
    if (!workspace) return

    const { left, width } = workspace.getBoundingClientRect()
    const minimumPaneWidth = 240
    const dividerWidth = 10
    const maximumWidth = Math.max(minimumPaneWidth, width - minimumPaneWidth - dividerWidth)
    const pointerOffset = clientX - left
    const nextWidth = isPaneOrderReversed ? width - pointerOffset - dividerWidth : pointerOffset
    setEditorWidth(Math.min(Math.max(nextWidth, minimumPaneWidth), maximumWidth))
  }, [isPaneOrderReversed])

  const handleDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setEditorWidthFromPosition(event.clientX)
  }, [setEditorWidthFromPosition])

  const handleDividerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      setEditorWidthFromPosition(event.clientX)
    }
  }, [setEditorWidthFromPosition])

  const handleDividerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current
    if (!workspace) return

    const currentWidth = editorWidth ?? workspace.getBoundingClientRect().width / 2
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const { left, width } = workspace.getBoundingClientRect()
      const dividerWidth = 10
      const dividerPosition = isPaneOrderReversed
        ? width - dividerWidth - currentWidth
        : currentWidth
      setEditorWidthFromPosition(left + dividerPosition + (event.key === 'ArrowLeft' ? -20 : 20))
    }
  }, [editorWidth, isPaneOrderReversed, setEditorWidthFromPosition])

  useEffect(() => {
    dirtyRef.current = isDirty
  }, [isDirty])

  const applyFile = useCallback((result: FileResult, fallbackPath?: string) => {
    if (!result.ok || result.content === undefined) {
      if (result.error) setError(result.error)
      return
    }

    const filePath = result.filePath ?? fallbackPath ?? null
    setValue(result.content)
    setCurrentPath(filePath)
    setIsDirty(false)
    setError(null)
    window.electronAPI.setCurrentFile(filePath)
  }, [])

  const confirmDiscard = useCallback((): boolean => {
    return !dirtyRef.current || window.confirm('保存されていない変更があります。破棄して別のファイルを開きますか？')
  }, [])

  const openPath = useCallback(
    async (filePath: string) => {
      if (!confirmDiscard()) return
      applyFile(await window.electronAPI.readFile(filePath), filePath)
    },
    [applyFile, confirmDiscard]
  )

  const handleOpen = useCallback(async () => {
    if (!confirmDiscard()) return
    applyFile(await window.electronAPI.openFileDialog())
  }, [applyFile, confirmDiscard])

  const handleSave = useCallback(async () => {
    let filePath = currentPath
    if (!filePath) {
      const selected = await window.electronAPI.saveFileDialog('untitled.md')
      if (!selected.ok || !selected.filePath) return
      filePath = selected.filePath
    }

    const targetPath = filePath
    if (!targetPath) return
    const result = await window.electronAPI.writeFile(targetPath, value)
    if (result.ok) {
      setCurrentPath(targetPath)
      setIsDirty(false)
      setError(null)
      window.electronAPI.setCurrentFile(targetPath)
    } else {
      setError(result.error ?? 'ファイルを保存できませんでした。')
    }
  }, [currentPath, value])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onOpenFile((filePath) => void openPath(filePath))
    void window.electronAPI.rendererReady()
    return unsubscribe
  }, [openPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpen, handleSave])

  useEffect(() => {
    const name = currentPath?.split(/[\\/]/).pop() ?? '無題'
    document.title = `${isDirty ? '● ' : ''}${name} - Markdown Editor`
  }, [currentPath, isDirty])

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="brand">Markdown Editor</div>
        <button type="button" onClick={() => void handleOpen()} title="Ctrl+O">開く</button>
        <button type="button" className="primary" onClick={() => void handleSave()} title="Ctrl+S">保存</button>
        <button
          type="button"
          onClick={togglePaneOrder}
          aria-pressed={isPaneOrderReversed}
          title="編集欄とプレビュー欄の位置を入れ替え"
        >
          左右を入れ替え
        </button>
        <div className="file-status" title={currentPath ?? '未保存'}>
          <span className={isDirty ? 'dirty-dot visible' : 'dirty-dot'} />
          {currentPath ?? '未保存'}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="エラーを閉じる">×</button>
        </div>
      )}

      <section
        ref={workspaceRef}
        className={isPaneOrderReversed ? 'workspace panes-swapped' : 'workspace'}
        style={editorWidth === null ? undefined : { '--editor-pane-width': `${editorWidth}px` } as React.CSSProperties}
      >
        <div className="pane editor-pane" aria-label="Markdownエディター">
          <CodeMirror
            value={value}
            height="100%"
            extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
            onChange={(nextValue) => {
              setValue(nextValue)
              setIsDirty(true)
            }}
          />
        </div>
        <div
          className="pane-divider"
          role="separator"
          aria-label="エディターとプレビューの幅を調整"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={handleDividerKeyDown}
        />
        <article className="pane preview-pane markdown-body" aria-label="Markdownプレビュー">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {value}
          </ReactMarkdown>
        </article>
      </section>
    </main>
  )
}

export default App



