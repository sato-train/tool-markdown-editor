# Electron Markdown Editor 実装ガイド（Windows右クリック対応優先）

Codex向けの実装指示書です。  
**最優先機能**: Windowsエクスプローラーで `.md` ファイルを右クリック → 「Open with / プログラムから開く」または「このアプリで開く」で起動し、そのファイルを即座に編集・プレビューできること。

---

## 1. 技術スタック

| 役割 | パッケージ |
|------|-----------|
| フレームワーク | Electron + electron-vite (React + TypeScript) |
| エディタ | `@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/language-data` |
| プレビュー | `react-markdown` + `remark-gfm` + `rehype-highlight` |
| スタイル | `github-markdown-css`（任意） |
| パッケージング | electron-builder（Windows NSIS） |
| ファイル関連付け | electron-builder の `fileAssociations` |

---

## 2. プロジェクト初期化

```bash
npm create @quick-start/electron@latest markdown-editor -- --template react-ts
cd markdown-editor
npm install

# 依存関係追加
npm install @uiw/react-codemirror @codemirror/lang-markdown @codemirror/language-data
npm install react-markdown remark-gfm rehype-highlight
npm install github-markdown-css
npm install -D @types/node
```

必要に応じて `electron-builder` が既に含まれているか確認し、なければ追加：

```bash
npm install -D electron-builder
```

---

## 3. 最重要：Windowsで.mdを右クリックから開けるようにする

### 3.1 electron-builder の設定（fileAssociations）

`electron-builder.yml` をプロジェクトルートに作成（または `package.json` の `build` フィールドに書く）。

```yaml
appId: com.yourname.markdown-editor
productName: Markdown Editor
directories:
  output: dist
  buildResources: build
files:
  - "out/**"
  - "package.json"
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  # インストール時にファイル関連付けを登録
  include: build/installer.nsh   # 必要ならカスタムNSIS

fileAssociations:
  - ext: md
    name: Markdown Document
    description: Markdown File
    mimeType: text/markdown
    role: Editor
    # icon: build/md.ico   # 任意。md専用アイコンがある場合
  - ext: markdown
    name: Markdown Document
    description: Markdown File
    mimeType: text/markdown
    role: Editor
```

`package.json` の scripts 例：

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "dist": "npm run build && electron-builder --win",
    "dist:dir": "npm run build && electron-builder --win --dir"
  }
}
```

これでインストーラー実行後、`.md` の「プログラムから開く」にアプリが出現し、デフォルトに設定すればダブルクリックでも開く。

### 3.2 メインプロセスで起動引数（ファイルパス）を受け取る

Electronは「Open with」や関連付けで起動されたとき、ファイルパスを `process.argv` に渡す。

**`src/main/index.ts`（または main エントリ）のポイント実装：**

```ts
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

// 単一インスタンスロック（既に起動中なら既存ウィンドウにファイルを渡す）
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 2回目以降の起動で渡されたファイルパスを処理
    const filePath = extractMarkdownPath(commandLine)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (filePath) {
        mainWindow.webContents.send('open-file', filePath)
      }
    }
  })
}

let mainWindow: BrowserWindow | null = null

function extractMarkdownPath(argv: string[]): string | null {
  // Windowsではパスにスペースが含まれることがあるので注意
  // process.argv の最後の方に .md / .markdown が来るのが一般的
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]
    if (
      (arg.endsWith('.md') || arg.endsWith('.markdown')) &&
      existsSync(arg) &&
      !arg.startsWith('-') // オプションを除外
    ) {
      return arg
    }
  }
  return null
}

function createWindow(initialFilePath: string | null = null) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // 必要に応じて
    }
  })

  // 開発時 / 本番時の読み込み
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ウィンドウ準備完了後に初期ファイルを送る
  mainWindow.webContents.on('did-finish-load', () => {
    if (initialFilePath) {
      mainWindow?.webContents.send('open-file', initialFilePath)
    }
  })
}

app.whenReady().then(() => {
  const initialPath = extractMarkdownPath(process.argv)
  createWindow(initialPath)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

### 3.3 Preload で安全にAPIを公開

**`src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // メインから来る「ファイルを開け」イベント
  onOpenFile: (callback: (filePath: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, filePath: string) => {
      callback(filePath)
    }
    ipcRenderer.on('open-file', subscription)
    // クリーンアップ用
    return () => {
      ipcRenderer.removeListener('open-file', subscription)
    }
  },

  // ファイル読み込み
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),

  // ファイル保存
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('write-file', filePath, content),

  // ダイアログで開く
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // ダイアログで保存
  saveFileDialog: (defaultPath?: string) =>
    ipcRenderer.invoke('save-file-dialog', defaultPath),

  // 現在のファイルパスをメインに通知（タイトルバー更新用など）
  setCurrentFile: (filePath: string | null) =>
    ipcRenderer.send('set-current-file', filePath)
})
```

### 3.4 メインプロセスの IPC ハンドラ

`src/main/index.ts` に追加：

```ts
ipcMain.handle('read-file', async (_event, filePath: string) => {
  try {
    const content = await readFile(filePath, 'utf-8')
    return { ok: true, content, filePath }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
  try {
    await writeFile(filePath, content, 'utf-8')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false }
  }
  const filePath = result.filePaths[0]
  const content = await readFile(filePath, 'utf-8')
  return { ok: true, content, filePath }
})

ipcMain.handle('save-file-dialog', async (_event, defaultPath?: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePath) {
    return { ok: false }
  }
  return { ok: true, filePath: result.filePath }
})
```

### 3.5 レンダラー側（React）でファイルを受け取る

**`src/renderer/src/App.tsx` のイメージ**

```tsx
import { useState, useEffect, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'github-markdown-css/github-markdown.css'

// 型定義（src/renderer/src/env.d.ts などに書く）
declare global {
  interface Window {
    electronAPI: {
      onOpenFile: (cb: (filePath: string) => void) => () => void
      readFile: (filePath: string) => Promise<{ ok: boolean; content?: string; filePath?: string; error?: string }>
      writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>
      openFileDialog: () => Promise<{ ok: boolean; content?: string; filePath?: string }>
      saveFileDialog: (defaultPath?: string) => Promise<{ ok: boolean; filePath?: string }>
      setCurrentFile: (filePath: string | null) => void
    }
  }
}

function App() {
  const [value, setValue] = useState('# Hello Markdown\n\n右クリックから開いてください')
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // メインから「このファイルを開け」と指示されたとき
  useEffect(() => {
    const unsubscribe = window.electronAPI.onOpenFile(async (filePath) => {
      const result = await window.electronAPI.readFile(filePath)
      if (result.ok && result.content !== undefined) {
        setValue(result.content)
        setCurrentPath(result.filePath || filePath)
        setIsDirty(false)
        window.electronAPI.setCurrentFile(result.filePath || filePath)
      } else {
        console.error('Failed to open file:', result.error)
      }
    })
    return unsubscribe
  }, [])

  const handleChange = useCallback((val: string) => {
    setValue(val)
    setIsDirty(true)
  }, [])

  const handleOpen = async () => {
    const result = await window.electronAPI.openFileDialog()
    if (result.ok && result.content !== undefined) {
      setValue(result.content)
      setCurrentPath(result.filePath || null)
      setIsDirty(false)
      window.electronAPI.setCurrentFile(result.filePath || null)
    }
  }

  const handleSave = async () => {
    if (currentPath) {
      const result = await window.electronAPI.writeFile(currentPath, value)
      if (result.ok) {
        setIsDirty(false)
      }
    } else {
      // 名前を付けて保存
      const saveResult = await window.electronAPI.saveFileDialog()
      if (saveResult.ok && saveResult.filePath) {
        const writeResult = await window.electronAPI.writeFile(saveResult.filePath, value)
        if (writeResult.ok) {
          setCurrentPath(saveResult.filePath)
          setIsDirty(false)
          window.electronAPI.setCurrentFile(saveResult.filePath)
        }
      }
    }
  }

  // Ctrl+S / Ctrl+O のショートカットも推奨
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault()
          handleSave()
        } else if (e.key === 'o') {
          e.preventDefault()
          handleOpen()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, handleOpen])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* 簡易ツールバー */}
      <div style={{ padding: '8px', borderBottom: '1px solid #ccc', display: 'flex', gap: '8px' }}>
        <button onClick={handleOpen}>開く</button>
        <button onClick={handleSave}>保存</button>
        <span style={{ marginLeft: 'auto', fontSize: '0.9em', color: '#666' }}>
          {currentPath ? currentPath : '未保存'} {isDirty ? '●' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* エディタ */}
        <div style={{ width: '50%', borderRight: '1px solid #ccc' }}>
          <CodeMirror
            value={value}
            height="100%"
            extensions={[
              markdown({ base: markdownLanguage, codeLanguages: languages })
            ]}
            onChange={handleChange}
          />
        </div>

        {/* プレビュー */}
        <div
          className="markdown-body"
          style={{ width: '50%', padding: '16px', overflow: 'auto' }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {value}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export default App
```

---

## 4. 開発時のテスト方法（右クリック相当）

インストーラーを毎回作らなくても、コマンドラインでファイルを渡せば同じ挙動をテストできる。

```bash
# 開発モードで特定のmdを開く
npm run dev -- path/to/test.md

# またはビルド後
./out/markdown-editor-win32-x64/markdown-editor.exe "C:\path\to\file.md"
```

`extractMarkdownPath` が正しく動いているか確認すること。

---

## 5. 実装順序（Codexへの推奨手順）

1. **プロジェクト作成**（electron-vite react-ts）
2. **依存関係インストール**
3. **メインプロセス**に `requestSingleInstanceLock` + `extractMarkdownPath` + `second-instance` を実装
4. **preload** で `onOpenFile` / `readFile` / `writeFile` / ダイアログAPIを公開
5. **IPCハンドラ**をメインに追加
6. **App.tsx** で `onOpenFile` を購読し、ファイル内容をエディタにセット
7. **基本的な開く・保存ボタンと Ctrl+O / Ctrl+S** を実装
8. **electron-builder.yml** に `fileAssociations` を追加
9. `npm run dist` でWindows用インストーラーを作成し、実際に `.md` を右クリックして動作確認
10. 必要に応じてアイコン（`.ico`）を追加

---

## 6. 注意点・よくある落とし穴

- **パスにスペースが含まれる場合**: `process.argv` の扱いを慎重に（上記の `extractMarkdownPath` を参考）。
- **既にアプリが起動している場合**: `requestSingleInstanceLock` と `second-instance` を必ず実装しないと、2つ目のウィンドウが開いてしまう。
- **開発時と本番時のパス**: `app.isPackaged` で分岐が必要なケースがある。
- **セキュリティ**: `contextIsolation: true`、`nodeIntegration: false` を維持し、preload経由のみでファイル操作する。
- **管理者権限**: ファイル関連付けの登録は通常のユーザー権限で可能（electron-builderのNSISが適切に処理する）。
- **アンインストール時**: electron-builderのNSISは関連付けを比較的きれいに削除してくれるが、完全に消えない場合もある。

---

## 7. 次の拡張候補（優先度低め）

- ダークモード
- ツールバー（太字・見出し挿入など）
- 画像ドラッグ＆ドロップ → 相対パスで挿入
- KaTeX / Mermaid
- 最近使ったファイル一覧
- ウィンドウタイトルにファイル名と dirty 状態を表示

---

## 8. 参考コマンドまとめ

```bash
# 開発
npm run dev

# 本番ビルド + Windowsインストーラー作成
npm run dist

# ディレクトリのみ（インストールなしでexe確認）
npm run dist:dir
```

このガイドに従って実装すれば、Windowsで `.md` ファイルを右クリック → アプリで開く、という最優先要件を満たせます。
