/**
 * @dsh-external/ui-file-browser — browser half.
 * Adds a directory button to workspace rows, a sidebar-width file panel with
 * left-slide transition, and a Files conversation view.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

export const inject = ['slots']

const API_PREFIX = '/@dsh-external/ui-file-browser/api'

let pendingOpenFile: { path: string; root?: string } | null = null

interface FileEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  children: TreeNode[]
}

interface WorkspaceInfo {
  id: string
  path: string
  title: string
}

type FileCategory = 'source' | 'config' | 'doc' | 'data' | 'other'

const DEFAULT_FILE_COLORS: Record<FileCategory, string> = {
  source: '#4a9eff',
  config: '#e6a23c',
  doc: '#52c41a',
  data: '#b37feb',
  other: 'var(--dsw-alias-label-secondary, #666)',
}

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'cc', 'cxx', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'ex', 'exs', 'erl', 'hs', 'lua', 'r', 'dart',
])

const CONFIG_EXTENSIONS = new Set([
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'dockerfile', 'makefile', 'mk', 'lock',
])

const DOC_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'rst', 'adoc', 'log',
])

const DATA_EXTENSIONS = new Set([
  'csv', 'tsv', 'jsonl',
])

function detectCategory(path: string): FileCategory {
  const lower = path.toLowerCase()
  const base = lower.split(/[\\/]/).pop() ?? ''
  if (base === 'dockerfile' || base === 'makefile') return 'config'
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  if (SOURCE_EXTENSIONS.has(ext)) return 'source'
  if (CONFIG_EXTENSIONS.has(ext)) return 'config'
  if (DOC_EXTENSIONS.has(ext)) return 'doc'
  if (DATA_EXTENSIONS.has(ext)) return 'data'
  return 'other'
}

function isImageFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? ''
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
}

function isMarkdownFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? ''
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  return ext === 'md' || ext === 'markdown'
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'new', 'class', 'extends', 'super', 'this', 'typeof', 'instanceof', 'in', 'of', 'try', 'catch',
  'finally', 'throw', 'async', 'await', 'yield', 'import', 'from', 'export', 'default', 'interface', 'type',
  'enum', 'implements', 'public', 'private', 'protected', 'static', 'readonly', 'package', 'namespace',
  'def', 'lambda', 'pass', 'None', 'True', 'False', 'and', 'or', 'not', 'is', 'with', 'as', 'assert', 'raise',
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'impl', 'trait', 'struct', 'match', 'move', 'ref', 'loop',
])

function highlightLine(line: string): React.ReactNode[] {
  const regex = /(\/\/[^\n]*|#[^\n]*|<!--.*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|from|export|default|interface|type|enum|implements|public|private|protected|static|readonly|package|namespace|def|lambda|pass|None|True|False|and|or|not|is|with|as|assert|raise|fn|mut|pub|use|mod|impl|trait|struct|match|move|ref|loop)\b)|([A-Za-z_$][\w$]*(?=\s*\())|(\b\d+(?:\.\d+)?\b)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index))
    const [full, comment, string, keyword, func, number] = match
    let color = 'var(--dsw-alias-label-primary)'
    if (comment !== undefined) color = 'var(--shiki-token-comment)'
    else if (string !== undefined) color = 'var(--shiki-token-string)'
    else if (keyword !== undefined) color = 'var(--shiki-token-keyword)'
    else if (func !== undefined) color = 'var(--shiki-token-function)'
    else if (number !== undefined) color = 'var(--shiki-token-constant)'
    nodes.push(React.createElement('span', { key, style: { color } }, full))
    key += 1
    lastIndex = match.index + full.length
  }
  if (lastIndex < line.length) nodes.push(line.slice(lastIndex))
  return nodes
}

function detectLang(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? ''
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
    sql: 'sql', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', xml: 'xml',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown', markdown: 'markdown',
  }
  return map[ext]
}

function fmtSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function loadFileState(root: string): Promise<{ opened: string[]; active: string | null; markdownMode: 'editor' | 'split' | 'preview' }> {
  try {
    const response = await fetch(`${API_PREFIX}/state?root=${encodeURIComponent(root)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? '加载文件浏览状态失败')
    return {
      opened: Array.isArray(data.opened) ? data.opened.filter((item: unknown): item is string => typeof item === 'string') : [],
      active: typeof data.active === 'string' ? data.active : null,
      markdownMode: data.markdownMode === 'split' || data.markdownMode === 'preview' ? data.markdownMode : 'editor',
    }
  } catch {
    // Ignore storage failures and start empty.
    return { opened: [], active: null, markdownMode: 'editor' }
  }
}

async function saveFileState(root: string, opened: readonly string[], active: string | null, markdownMode: 'editor' | 'split' | 'preview'): Promise<void> {
  try {
    await fetch(`${API_PREFIX}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, opened: [...opened], active, markdownMode }),
    })
  } catch {
    // Ignore storage failures; persistence is best-effort.
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')
}

function dirnamePath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (index <= 0) return normalized
  return normalized.slice(0, index)
}

function isPathInside(root: string, target: string): boolean {
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const normalizedTarget = target.replace(/[\\/]+$/, '')
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + '/') || normalizedTarget.startsWith(normalizedRoot + '\\')
}

function switchToFilesView(): void {
  requestAnimationFrame(() => {
    const tab = Array.from(document.querySelectorAll('button')).find(button => {
      const text = button.textContent?.trim()
      return text === '文件' && button.closest('[class*="header"]') !== null
    })
    tab?.click()
  })
}

function openInFilesView(path: string, root?: string): void {
  pendingOpenFile = { path, ...root === undefined ? {} : { root } }
  window.dispatchEvent(new CustomEvent('dsh-open-file', { detail: { path, ...root === undefined ? {} : { root } } }))
  switchToFilesView()
}

function resolveWorkspacePath(root: string, path: string): string {
  if (path.startsWith('file://')) {
    return path.slice('file://'.length).replace(/^\/([a-zA-Z]:)/, '$1')
  }
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path
  return `${root.replace(/[\\/]+$/, '')}/${path}`
}

function ChevronIcon({ open }: { open: boolean }) {
  return React.createElement('svg', {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease', flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M9 6l6 6-6 6' }))
}

function FolderIcon({ open }: { open: boolean }) {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z' }),
    open ? React.createElement('path', { d: 'M3 10h18' }) : null)
}

function FileIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }),
    React.createElement('path', { d: 'M14 3v5h5' }))
}

function SourceFileIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M8 9l-3 3 3 3' }), React.createElement('path', { d: 'M16 9l3 3-3 3' }), React.createElement('path', { d: 'M13 5l-2 14' }))
}

function ConfigFileIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('circle', { cx: 12, cy: 12, r: 3 }), React.createElement('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }))
}

function DocFileIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }),
    React.createElement('path', { d: 'M14 3v5h5' }), React.createElement('path', { d: 'M8 13h8' }), React.createElement('path', { d: 'M8 17h5' }))
}

function DataFileIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0 },
    'aria-hidden': true,
  }, React.createElement('ellipse', { cx: 12, cy: 5, rx: 8, ry: 3 }), React.createElement('path', { d: 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5' }), React.createElement('path', { d: 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }))
}

function FileTypeIcon({ path }: { path: string }) {
  const category = detectCategory(path)
  if (category === 'source') return React.createElement(SourceFileIcon)
  if (category === 'config') return React.createElement(ConfigFileIcon)
  if (category === 'doc') return React.createElement(DocFileIcon)
  if (category === 'data') return React.createElement(DataFileIcon)
  return React.createElement(FileIcon)
}

function RenameIcon() {
  return React.createElement('svg', {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M12 20h9' }), React.createElement('path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' }))
}

function DeleteIcon() {
  return React.createElement('svg', {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M3 6h18' }), React.createElement('path', { d: 'M8 6V4h8v2' }), React.createElement('path', { d: 'M19 6l-1 14H6L5 6' }))
}

function BackIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M19 12H5' }), React.createElement('path', { d: 'M12 19l-7-7 7-7' }))
}

function ChevronDownIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M6 9l6 6 6-6' }))
}

function ChevronUpIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M6 15l6-6 6 6' }))
}

function MoveIcon() {
  return React.createElement('svg', {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z' }), React.createElement('path', { d: 'M12 12v6' }), React.createElement('path', { d: 'M9 15l3 3 3-3' }))
}

function EditorIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M8 6l-5 6 5 6' }), React.createElement('path', { d: 'M16 6l5 6-5 6' }))
}

function SplitIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), React.createElement('path', { d: 'M12 4v16' }))
}

function PreviewIcon() {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }, React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }), React.createElement('circle', { cx: 12, cy: 12, r: 3 }))
}

function buildTree(entries: FileEntry[]): TreeNode[] {
  const roots: TreeNode[] = []
  const map = new Map<string, TreeNode>()
  for (const entry of entries) {
    const parts = entry.name.split('/')
    let current = roots
    let prefix = ''
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      prefix = prefix === '' ? part : `${prefix}/${part}`
      let node = map.get(prefix)
      if (node === undefined) {
        node = {
          name: part,
          path: entry.path,
          type: index === parts.length - 1 ? entry.type : 'dir',
          size: index === parts.length - 1 ? entry.size : 0,
          children: [],
        }
        map.set(prefix, node)
        current.push(node)
      }
      current = node.children
    }
  }
  return roots
}

function FileTree({ entries, selected, onSelect, onOpen, onManage, onMoveTo }: {
  entries: FileEntry[]
  selected: string | null
  onSelect: (path: string) => void
  onOpen: (entry: FileEntry) => void
  onManage?: (action: 'rename' | 'delete', node: TreeNode) => void
  onMoveTo?: (targetDirPath: string, draggedPath: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragReadyPath, setDragReadyPath] = useState<string | null>(null)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const tree = useMemo(() => buildTree(entries), [entries])

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
  }, [])

  function toggle(path: string) {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function startLongPress(path: string) {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = window.setTimeout(() => {
      setDragReadyPath(path)
    }, 500)
  }

  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function actionButton(action: 'rename' | 'delete', node: TreeNode) {
    return React.createElement('button', {
      type: 'button',
      title: action === 'rename' ? '重命名' : '删除',
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation()
        onManage?.(action, node)
      },
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #666)',
        flexShrink: 0,
      },
    }, action === 'rename' ? React.createElement(RenameIcon) : React.createElement(DeleteIcon))
  }

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode[] {
    return nodes.map(node => {
      const isDir = node.type === 'dir'
      const isExpanded = expanded.has(node.path)
      const isSelected = selected === node.path
      const row = React.createElement(
        'div',
        {
          key: node.path,
          'data-dsh-file-row': 'true',
          draggable: true,
          onPointerDown: (event: React.PointerEvent) => {
            if (event.button !== 0) return
            startLongPress(node.path)
          },
          onPointerMove: (event: React.PointerEvent) => {
            if (dragReadyPath === null && event.movementX !== 0 && event.movementY !== 0) cancelLongPress()
          },
          onPointerUp: () => cancelLongPress(),
          onPointerLeave: () => cancelLongPress(),
          onDragStart: (event: React.DragEvent) => {
            event.dataTransfer.setData('text/plain', node.path)
            event.dataTransfer.effectAllowed = 'move'
            setDragPath(node.path)
            setDragReadyPath(null)
          },
          onDragEnd: () => {
            setDragPath(null)
            setDragReadyPath(null)
            setDropTargetPath(null)
          },
          onDragOver: isDir ? (event: React.DragEvent) => {
            if (dragPath !== null && dragPath !== node.path) {
              event.preventDefault()
              setDropTargetPath(node.path)
            }
          } : undefined,
          onDragLeave: isDir ? () => {
            setDropTargetPath(current => current === node.path ? null : current)
          } : undefined,
          onDrop: isDir ? (event: React.DragEvent) => {
            event.preventDefault()
            const source = dragPath ?? event.dataTransfer.getData('text/plain')
            if (source && source !== node.path) onMoveTo?.(node.path, source)
            setDragPath(null)
            setDragReadyPath(null)
            setDropTargetPath(null)
          } : undefined,
          onClick: () => {
            if (isDir) toggle(node.path)
            else onSelect(node.path)
          },
          onDoubleClick: () => {
            if (!isDir) onOpen({ path: node.path, name: node.name, type: 'file', size: node.size, mtime: 0 })
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 30,
            padding: '0 8px',
            paddingLeft: 8 + depth * 14,
            cursor: 'pointer',
            background: isSelected || dropTargetPath === node.path ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            borderRadius: 8,
            outline: dropTargetPath === node.path ? '2px solid var(--dsw-alias-interactive-bg-active, #4a90d9)' : 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--dsw-alias-label-primary)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          },
        },
        isDir ? React.createElement(ChevronIcon, { open: isExpanded }) : React.createElement('span', { style: { width: 12, flexShrink: 0 } }),
        isDir ? React.createElement(FolderIcon, { open: isExpanded }) : React.createElement(FileTypeIcon, { path: node.path }),
        React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 } }, node.name),
        !isDir ? React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #999)', flexShrink: 0 } }, fmtSize(node.size)) : null,
        onManage === undefined ? null : React.createElement('span', { style: { display: 'inline-flex', gap: 2, flexShrink: 0 } },
          actionButton('rename', node),
          actionButton('delete', node),
        ),
      )
      if (!isDir || !isExpanded) return row
      return React.createElement(React.Fragment, { key: node.path }, row, ...renderNodes(node.children, depth + 1))
    })
  }

  return React.createElement('div', { onDragOver: (event: React.DragEvent) => { event.preventDefault() } }, ...renderNodes(tree, 0))
}

function DirectoryPanel() {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ path: string }>).detail
      if (detail?.path) setOpenPath(detail.path)
    }
    window.addEventListener('dsh-open-directory', onOpen)
    return () => window.removeEventListener('dsh-open-directory', onOpen)
  }, [])

  useEffect(() => {
    if (openPath === null) return
    let current = true
    setLoading(true)
    setError('')
    setSelected(null)
    fetch(`${API_PREFIX}/tree?path=${encodeURIComponent(openPath)}`)
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? '加载目录失败')
        if (current) setEntries(data.entries ?? [])
      })
      .catch(err => {
        if (current) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [openPath])

  if (openPath === null) return null

  function openFile(entry: FileEntry) {
    openInFilesView(entry.path, openPath)
  }

  return React.createElement(
    'div',
    {
      style: {
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 'min(360px, 80vw)',
        background: 'var(--dsw-specific-sidebar-fill)',
        borderRight: '1px solid var(--dsw-alias-border-primary, #e5e5e5)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        animation: 'dsh-file-browser-slide-in .25s ease-out',
        boxShadow: 'none',
      },
    },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-primary, #e5e5e5)' } },
      React.createElement('strong', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, openPath),
      React.createElement('button', {
        type: 'button',
        title: '返回',
        'aria-label': '返回',
        onClick: () => setOpenPath(null),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--dsw-alias-label-secondary, #666)',
        },
      }, React.createElement(BackIcon)),
    ),
    React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: 8 } },
      loading ? React.createElement('div', null, '加载中…')
        : error !== '' ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary, #d33)' } }, error)
          : entries.length === 0 ? React.createElement('div', null, '目录为空')
            : React.createElement(FileTree, { entries, selected, onSelect: setSelected, onOpen: openFile }),
    ),
  )
}

function SidebarFilePanel({ rootPath, onClose }: { rootPath: string; onClose: () => void }) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState<{ type: 'rename' | 'delete'; node: TreeNode } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_PREFIX}/tree?path=${encodeURIComponent(rootPath)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '加载目录失败')
      setEntries(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSelected(null)
    void load()
  }, [rootPath])

  function openRename(node: TreeNode) {
    setRenameValue(node.name)
    setModal({ type: 'rename', node })
  }

  function openDelete(node: TreeNode) {
    setModal({ type: 'delete', node })
  }

  async function performRename() {
    if (modal?.type !== 'rename') return
    const newName = renameValue.trim()
    if (newName === '') return
    const node = modal.node
    setModal(null)
    setLoading(true)
    try {
      const response = await fetch(`${API_PREFIX}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: rootPath, path: node.path, newName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '重命名失败')
      setNotice(`已重命名为 ${newName}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  async function performDelete() {
    if (modal?.type !== 'delete') return
    const node = modal.node
    setModal(null)
    setLoading(true)
    try {
      const response = await fetch(`${API_PREFIX}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: rootPath, path: node.path }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '删除失败')
      setNotice(`已删除 ${node.name}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  async function moveTo(targetDirPath: string, draggedPath: string) {
    if (targetDirPath === draggedPath) return
    const relativeTarget = targetDirPath === rootPath
      ? ''
      : targetDirPath.startsWith(rootPath)
        ? targetDirPath.slice(rootPath.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
        : ''
    setLoading(true)
    try {
      const response = await fetch(`${API_PREFIX}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: rootPath, path: draggedPath, destination: relativeTarget }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '移动失败')
      setNotice(`已移动到 ${relativeTarget || '工作区根目录'}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  function openFile(entry: FileEntry) {
    openInFilesView(entry.path, rootPath)
  }

  const modalNode = modal === null ? null : React.createElement(
    'div',
    { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
    React.createElement(
      'div',
      { style: { width: 300, background: 'var(--dsw-alias-bg-layer-1, #fff)', borderRadius: 12, padding: 16, boxShadow: 'var(--dsw-shadow-lv2, 0 4px 20px rgba(0,0,0,.15))', display: 'flex', flexDirection: 'column', gap: 12 } },
      React.createElement('strong', null, modal.type === 'rename' ? '重命名' : '删除确认'),
      modal.type === 'rename'
        ? React.createElement('input', {
          type: 'text',
          value: renameValue,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setRenameValue(event.target.value),
          style: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-primary, #ccc)', background: 'transparent', color: 'var(--dsw-alias-label-primary)' },
        })
        : React.createElement('div', null, `确认删除 ${modal.node.name}？此操作不可恢复。`),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        React.createElement('button', { type: 'button', onClick: () => setModal(null), style: buttonStyle }, '取消'),
        React.createElement('button', {
          type: 'button',
          onClick: modal.type === 'rename' ? () => void performRename() : () => void performDelete(),
          style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary, #d33)' },
        }, modal.type === 'rename' ? '确认' : '删除'),
      ),
    ),
  )

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 14 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-primary, #e5e5e5)' } },
      React.createElement('strong', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, rootPath),
      React.createElement('button', {
        type: 'button',
        title: '返回',
        'aria-label': '返回',
        onClick: onClose,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--dsw-alias-label-secondary, #666)',
        },
      }, React.createElement(BackIcon)),
    ),
    React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: 8 } },
      notice === '' ? null : React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary, #2a7a32)', fontSize: 12, marginBottom: 6 } }, notice),
      loading && entries.length === 0 ? React.createElement('div', null, '加载中…')
        : error !== '' ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary, #d33)' } }, error)
          : entries.length === 0 ? React.createElement('div', null, '目录为空')
            : React.createElement(FileTree, {
              entries,
              selected,
              onSelect: setSelected,
              onOpen: openFile,
              onManage: (action, node) => {
                if (action === 'rename') openRename(node)
                else openDelete(node)
              },
              onMoveTo: moveTo,
            }),
    ),
    createPortal(modalNode, document.body),
  )
}

function FilesView(props: any) {
  const { sessionId, useSessions } = props
  const cwd = useSessions((state: any) => state.byId?.[String(sessionId)]?.cwd)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const [opened, setOpened] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [content, setContent] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [filesOverflow, setFilesOverflow] = useState(false)
  const [markdownMode, setMarkdownMode] = useState<'editor' | 'split' | 'preview'>('editor')
  const [barRect, setBarRect] = useState<{ left: number; width: number } | null>(null)
  const [headerRect, setHeaderRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const codeScrollRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const highlightRef = useRef<HTMLPreElement | null>(null)
  const lineNumbersRef = useRef<HTMLDivElement | null>(null)
  const scrollPositions = useRef<Map<string, { left: number; top: number }>>(new Map())
  const activeRef = useRef(active)
  activeRef.current = active

  function saveScrollPosition() {
    const key = activeRef.current
    if (key !== null) {
      scrollPositions.current.set(key, {
        left: codeScrollRef.current?.scrollLeft ?? 0,
        top: codeScrollRef.current?.scrollTop ?? 0,
      })
    }
  }

  function syncHighlightScroll() {
    if (codeScrollRef.current !== null && highlightRef.current !== null) {
      highlightRef.current.scrollTop = codeScrollRef.current.scrollTop
      highlightRef.current.scrollLeft = codeScrollRef.current.scrollLeft
    }
    if (codeScrollRef.current !== null && lineNumbersRef.current !== null) {
      lineNumbersRef.current.scrollTop = codeScrollRef.current.scrollTop
    }
  }

  useLayoutEffect(() => {
    const el = measureRef.current
    if (el) setFilesOverflow(el.scrollHeight > 36)
  }, [opened])

  useLayoutEffect(() => {
    const root = rootRef.current
    const header = headerRef.current
    if (root === null) return
    const measure = () => {
      const rect = root.getBoundingClientRect()
      setBarRect({ left: rect.left, width: rect.width })
      if (header !== null) {
        const headerBounds = header.getBoundingClientRect()
        setHeaderRect({
          top: headerBounds.top,
          left: headerBounds.left,
          width: headerBounds.width,
          height: headerBounds.height,
        })
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    if (header !== null) observer.observe(header)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, content])

  useEffect(() => {
    if (hydrated && typeof cwd === 'string' && cwd !== '') void saveFileState(cwd, opened, active, markdownMode)
  }, [hydrated, cwd, opened, active, markdownMode])

  useEffect(() => {
    if (typeof cwd !== 'string' || cwd === '') {
      setHydrated(false)
      return
    }
    let current = true
    setHydrated(false)
    void loadFileState(cwd).then(saved => {
      if (!current) return
      const pending = pendingOpenFile
      pendingOpenFile = null
      const nextOpened = pending !== null && !saved.opened.includes(pending.path)
        ? [...saved.opened, pending.path]
        : saved.opened
      setOpened(nextOpened)
      setActive(pending?.path ?? saved.active)
      setMarkdownMode(saved.markdownMode)
      if (pending !== null) void loadContent(pending.path, pending.root)
      else if (saved.active !== null) void loadContent(saved.active)
      else {
        setContent('')
        setImageDataUrl(null)
      }
      setHydrated(true)
    })
    return () => { current = false }
  }, [cwd])

  useEffect(() => {
    return () => {
      const key = active
      if (key !== null) {
        scrollPositions.current.set(key, {
          left: codeScrollRef.current?.scrollLeft ?? 0,
          top: contentScrollRef.current?.scrollTop ?? 0,
        })
      }
    }
  }, [active])

  useLayoutEffect(() => {
    const saved = active === null ? undefined : scrollPositions.current.get(active)
    if (codeScrollRef.current !== null) {
      codeScrollRef.current.scrollLeft = saved?.left ?? 0
      codeScrollRef.current.scrollTop = saved?.top ?? 0
      syncHighlightScroll()
    }
    if (topScrollRef.current !== null) topScrollRef.current.scrollLeft = saved?.left ?? 0
  }, [active, content])

  useEffect(() => {
    const content = codeScrollRef.current
    const top = topScrollRef.current
    if (content === null || top === null) return
    const savePosition = () => {
      if (active !== null) {
        scrollPositions.current.set(active, {
          left: content.scrollLeft,
          top: content.scrollTop,
        })
      }
    }
    const syncTop = () => {
      savePosition()
      syncHighlightScroll()
      top.scrollLeft = content.scrollLeft
    }
    const syncContent = () => { content.scrollLeft = top.scrollLeft }
    const updateSpacer = () => {
      const spacer = top.firstElementChild as HTMLElement | null
      if (spacer !== null) spacer.style.width = `${Math.max(content.scrollWidth, top.clientWidth)}px`
    }
    content.addEventListener('scroll', syncTop)
    top.addEventListener('scroll', syncContent)
    const observer = new ResizeObserver(() => {
      updateSpacer()
      syncTop()
    })
    observer.observe(content)
    updateSpacer()
    return () => {
      content.removeEventListener('scroll', syncTop)
      top.removeEventListener('scroll', syncContent)
      observer.disconnect()
    }
  }, [active, markdownMode, content])

  useEffect(() => {
    function onOpenFile(event: Event) {
      const detail = (event as CustomEvent<{ path: string; root?: string }>).detail
      if (detail?.path) {
        pendingOpenFile = null
        setOpened(current => current.includes(detail.path) ? current : [...current, detail.path])
        setActive(detail.path)
        void loadContent(detail.path, detail.root)
      }
    }
    window.addEventListener('dsh-open-file', onOpenFile)
    return () => window.removeEventListener('dsh-open-file', onOpenFile)
  }, [cwd])

  async function loadContent(path: string, root?: string) {
    const workspaceRoot = root ?? cwdRef.current
    if (!workspaceRoot) return
    const resolvedPath = resolveWorkspacePath(workspaceRoot, path)
    const effectiveRoot = isAbsolutePath(path) && !isPathInside(workspaceRoot, resolvedPath)
      ? dirnamePath(resolvedPath)
      : workspaceRoot
    setLoading(true)
    setError('')
    setSaveStatus('')
    setImageDataUrl(null)
    try {
      const response = await fetch(`${API_PREFIX}/file?root=${encodeURIComponent(effectiveRoot)}&path=${encodeURIComponent(resolvedPath)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '读取文件失败')
      if (data.kind === 'image' && typeof data.dataUrl === 'string') {
        setContent('')
        setImageDataUrl(data.dataUrl)
      } else {
        setContent(data.content ?? '')
        setImageDataUrl(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setContent('')
      setImageDataUrl(null)
    } finally {
      setLoading(false)
    }
  }

  async function saveContent() {
    if (active === null || imageDataUrl !== null) return
    const workspaceRoot = cwdRef.current
    if (!workspaceRoot) return
    const resolvedPath = resolveWorkspacePath(workspaceRoot, active)
    const effectiveRoot = isAbsolutePath(active) && !isPathInside(workspaceRoot, resolvedPath)
      ? dirnamePath(resolvedPath)
      : workspaceRoot
    setSaveStatus('保存中…')
    try {
      const response = await fetch(`${API_PREFIX}/write`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: effectiveRoot, path: resolvedPath, content }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '保存失败')
      setSaveStatus('已保存')
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveContent()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, imageDataUrl, content, cwd])

  function closeFile(path: string) {
    const next = opened.filter(candidate => candidate !== path)
    setOpened(next)
    if (active === path) {
      setActive(next.length > 0 ? next[next.length - 1] : null)
      if (next.length > 0) void loadContent(next[next.length - 1])
      else {
        setContent('')
        setImageDataUrl(null)
      }
    }
  }

  function displayName(path: string): string {
    const base = path.split(/[\\/]/).pop() ?? path
    const sameBaseCount = opened.filter(candidate => (candidate.split(/[\\/]/).pop() ?? candidate) === base).length
    if (sameBaseCount <= 1) return base
    const parent = path.replace(/[\\/][^\\/]*$/, '').split(/[\\/]/).pop()
    return parent ? `${parent}/${base}` : base
  }

  const openedTabs = opened.map(path => React.createElement(
    'span',
    {
      key: path,
      'data-dsh-file-tab': 'true',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-primary, #ccc)',
        background: active === path ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        fontWeight: active === path ? 700 : 400,
        cursor: 'pointer',
      },
    },
    React.createElement('button', {
      type: 'button',
      onClick: () => {
        setActive(path)
        void loadContent(path)
      },
      style: { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: DEFAULT_FILE_COLORS[detectCategory(path)], fontSize: 12 },
    }, displayName(path)),
    React.createElement('button', {
      type: 'button',
      title: '关闭文件',
      onClick: () => closeFile(path),
      style: { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 12 },
    }, '×'),
  ))

  const tabs = React.createElement('div', { ref: measureRef, style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, openedTabs)
  const tabsContainer = React.createElement('div', { ref: tabsRef, style: { maxHeight: filesExpanded ? 'none' : 34, overflow: 'hidden' } }, tabs)
  const filesToggle = filesOverflow
    ? React.createElement('button', {
      type: 'button',
      title: filesExpanded ? '收缩' : '展开',
      'aria-label': filesExpanded ? '收缩' : '展开',
      onClick: () => setFilesExpanded(v => !v),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #666)',
        flexShrink: 0,
      },
    }, filesExpanded ? React.createElement(ChevronUpIcon) : React.createElement(ChevronDownIcon))
    : null

  const isMarkdownActive = active !== null && isMarkdownFile(active)
  const modeSwitcher = isMarkdownActive
    ? React.createElement('div', { style: { display: 'inline-flex', gap: 2, marginLeft: 'auto', flexShrink: 0 } },
      [['editor', EditorIcon, '编辑器模式'], ['split', SplitIcon, '编辑器与预览模式'], ['preview', PreviewIcon, '预览模式']].map(([mode, Icon, label]) => {
        const selected = markdownMode === mode
        return React.createElement('button', {
          key: mode as string,
          type: 'button',
          title: label as string,
          'aria-label': label as string,
          onClick: () => setMarkdownMode(mode as 'editor' | 'split' | 'preview'),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            padding: 0,
            border: 'none',
            background: selected ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            cursor: 'pointer',
            color: selected ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary, #666)',
            borderRadius: 6,
          },
        }, React.createElement(Icon as () => React.ReactElement))
      }),
    )
    : null

  const saveButton = active !== null && imageDataUrl === null
    ? React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: modeSwitcher === null ? 'auto' : 0, flexShrink: 0 } },
      saveStatus === '' ? null : React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' } }, saveStatus),
      React.createElement('button', {
        type: 'button',
        onClick: () => void saveContent(),
        disabled: loading,
        style: buttonStyle,
      }, '保存'),
    )
    : null

  const codeEditorNode = React.createElement('div', { style: { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 } },
    React.createElement('div', {
      ref: lineNumbersRef,
      style: {
        flexShrink: 0,
        width: 52,
        overflow: 'hidden',
        padding: '8px 0',
        textAlign: 'right',
        color: 'var(--dsw-alias-label-tertiary, #999)',
        userSelect: 'none',
        borderRight: '1px solid var(--dsw-alias-border-primary, #eee)',
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 1.6,
      },
    },
      React.createElement('div', { style: { paddingRight: 6 } },
        content.split('\n').map((_, index) => React.createElement('div', { key: index }, index + 1)),
      ),
    ),
    React.createElement('div', { style: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' } },
      React.createElement('pre', {
        ref: highlightRef,
        'aria-hidden': true,
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          margin: 0,
          padding: '8px 10px',
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: 'pre',
          overflow: 'hidden',
          pointerEvents: 'none',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
        content.split('\n').map((line, index) => React.createElement('div', { key: index }, highlightLine(line))),
      ),
      React.createElement('textarea', {
        ref: codeScrollRef,
        className: 'dsh-file-code-scroll',
        value: content,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setContent(event.target.value),
        onScroll: () => {
          saveScrollPosition()
          syncHighlightScroll()
        },
        spellCheck: false,
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: 'pre',
          overflow: 'auto',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
          caretColor: 'var(--dsw-alias-label-primary)',
        },
      }),
    ),
  )

  const markdownPreviewNode = React.createElement('div', { style: { padding: '8px 12px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, overflow: 'auto', flex: 1, minWidth: 0, minHeight: 0 } },
    React.createElement(MarkdownText, { text: content }),
  )

  return React.createElement('div', { ref: rootRef, style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, height: '100%', boxSizing: 'border-box' } },
    React.createElement('div', {
      ref: headerRef,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--dsw-alias-border-primary, #e5e5e5)',
        paddingBottom: 8,
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: 'var(--dsw-alias-bg-layer-1, #fafafa)',
      },
    },
      openedTabs.length === 0
        ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' } }, '尚未打开文件')
        : React.createElement(React.Fragment, null, tabsContainer, filesToggle),
      modeSwitcher,
      saveButton,
    ),
    React.createElement('div', { ref: contentScrollRef, style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'monospace', fontSize: 12, background: 'var(--dsw-alias-bg-layer-1, #fafafa)', borderRadius: 8 } },
      error !== '' ? React.createElement('span', { style: { color: 'var(--dsw-alias-state-error-primary, #d33)', padding: 8 } }, error)
        : active === null ? React.createElement('span', { style: { padding: 8, color: 'var(--dsw-alias-label-secondary, #666)' } }, '点击聊天中的文件链接或从文件导航栏打开文件后，内容将显示在这里')
          : loading ? React.createElement('span', { style: { padding: 8 } }, '加载中…')
            : imageDataUrl !== null
              ? React.createElement('div', { style: { display: 'flex', flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 12 } },
                React.createElement('img', {
                  src: imageDataUrl,
                  alt: active ?? '图片预览',
                  style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 },
                }),
              )
              : active !== null && isMarkdownFile(active)
                ? markdownMode === 'preview'
                  ? markdownPreviewNode
                  : markdownMode === 'split'
                    ? React.createElement('div', { style: { display: 'flex', flex: 1, minHeight: 0, width: '100%' } },
                      codeEditorNode,
                      React.createElement('div', { style: { width: 2, background: 'var(--dsw-alias-border-primary, #ccc)', flexShrink: 0, margin: '8px 0' } }),
                      markdownPreviewNode,
                    )
                    : codeEditorNode
                : codeEditorNode,
    ),
    active !== null && imageDataUrl === null
      ? createPortal(
        React.createElement('div', {
          ref: topScrollRef,
          className: 'dsh-file-bottom-scroll',
          style: {
            position: 'fixed',
            top: (headerRect === null ? 0 : headerRect.top + headerRect.height),
            left: barRect?.left ?? 0,
            width: barRect?.width ?? '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            height: 10,
            zIndex: 1000,
            background: 'var(--dsw-alias-bg-layer-1, #fafafa)',
            borderTop: '1px solid var(--dsw-alias-border-primary, #e5e5e5)',
          },
        },
        React.createElement('div', { style: { height: 1 } }),
        ),
        document.body,
      )
      : null,
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-primary, #ccc)',
  background: 'transparent',
  cursor: 'pointer',
}

function installWorkspaceButtons(): () => void {
  let workspaces: WorkspaceInfo[] = []
  let observer: MutationObserver | undefined
  let stopped = false
  let sidebarRoot: HTMLElement | null = null
  let filePanel: HTMLElement | null = null
  let filePanelReactRoot: Root | null = null

  async function loadWorkspaces() {
    try {
      const response = await fetch(`${API_PREFIX}/workspaces`)
      const data = await response.json()
      if (response.ok) workspaces = data.workspaces ?? []
    } catch {
      workspaces = []
    }
  }

  function closeDirectory() {
    if (!sidebarRoot || !filePanel) return
    filePanel.style.transform = 'translateX(100%)'
    sidebarRoot.style.transform = 'translateX(0)'
  }

  function openDirectory(path: string, row: Element) {
    const root = row.closest('[class*="root"]') as HTMLElement | null
    const container = row.closest('[class*="regionArea"]') as HTMLElement | null ?? root?.parentElement ?? null
    if (!root || !container) {
      window.dispatchEvent(new CustomEvent('dsh-open-directory', { detail: { path } }))
      return
    }
    sidebarRoot = root
    if (!filePanel || filePanel.parentElement !== container) {
      filePanel?.remove()
      filePanelReactRoot?.unmount()
      filePanel = document.createElement('div')
      filePanel.dataset.dshFileBrowserPanel = 'true'
      filePanel.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:var(--dsw-specific-sidebar-fill);transform:translateX(100%);transition:transform .25s ease;z-index:10'
      container.appendChild(filePanel)
      if (container.style.position === '') container.style.position = 'relative'
      if (container.style.overflow === '') container.style.overflow = 'hidden'
      filePanelReactRoot = createRoot(filePanel)
    }
    filePanelReactRoot?.render(React.createElement(SidebarFilePanel, {
      rootPath: path,
      onClose: closeDirectory,
    }))
    requestAnimationFrame(() => {
      root.style.transition = 'transform .25s ease'
      root.style.transform = 'translateX(-100%)'
      if (filePanel) filePanel.style.transform = 'translateX(0)'
    })
  }

  function scan() {
    if (stopped) return
    const rows = document.querySelectorAll('[class*="projectRow"], [role="treeitem"]')
    rows.forEach(row => {
      const titleEl = row.querySelector('[class*="title"]')
      const title = titleEl?.textContent?.trim() ?? ''
      const newSessionButton = Array.from(row.querySelectorAll('button')).find(button => {
        const label = button.getAttribute('aria-label') ?? ''
        return label.includes('新建会话') || label.includes('New Session')
      })
      const actions = newSessionButton?.parentElement
      if (!actions || actions.querySelector('[data-dsh-file-browser]')) return
      const workspace = workspaces.find(candidate => candidate.title === title)
        ?? workspaces.find(candidate => title !== '' && candidate.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() === title)
        ?? (workspaces.length === 1 ? workspaces[0] : undefined)
      if (!workspace) return
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.dshFileBrowser = 'true'
      button.title = '展开目录'
      button.setAttribute('aria-label', '展开目录')
      button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#666)'
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z"/></svg>'
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        openDirectory(workspace.path, row)
      })
      actions.insertBefore(button, newSessionButton)
    })
  }

  void loadWorkspaces().then(() => {
    scan()
    setTimeout(scan, 500)
    observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
  })

  return () => {
    stopped = true
    observer?.disconnect()
    document.querySelectorAll('[data-dsh-file-browser]').forEach(node => node.remove())
    filePanelReactRoot?.unmount()
    filePanel?.remove()
    if (sidebarRoot) {
      sidebarRoot.style.transform = ''
      sidebarRoot.style.transition = ''
    }
  }
}

function installFileLinkInterceptor(): () => void {
  function looksLikeLocalPath(value: string): boolean {
    return value.startsWith('file://')
      || /^[a-zA-Z]:[\\/]/.test(value)
      || value.startsWith('/')
  }

  function normalizeFilePath(value: string): string {
    if (value.startsWith('file://')) {
      const rest = decodeURIComponent(value.slice('file://'.length))
      return rest.replace(/^\/([a-zA-Z]:)/, '$1')
    }
    return decodeURIComponent(value)
  }

  function onClick(event: MouseEvent) {
    const target = event.target as Element | null
    const toolLink = target?.closest?.('button[class*="fileLink"]')
    if (toolLink) {
      const path = toolLink.textContent?.trim()
      if (path) {
        event.preventDefault()
        event.stopPropagation()
        openInFilesView(path)
      }
      return
    }
    const anchor = target?.closest?.('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (href === '' || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) return
    if (!looksLikeLocalPath(href)) return
    event.preventDefault()
    event.stopPropagation()
    openInFilesView(normalizeFilePath(href))
  }

  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

export function apply(ctx: any): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = '@keyframes dsh-file-browser-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } } [data-dsh-file-row] { border-radius: 8; transition: background .15s ease; } [data-dsh-file-row]:hover { background: var(--dsw-alias-interactive-bg-hover) !important; } [data-dsh-file-tab] { transition: background .15s ease; } [data-dsh-file-tab]:hover { background: var(--dsw-alias-interactive-bg-hover) !important; } .dsh-file-code-scroll::-webkit-scrollbar:horizontal { height: 0; } .dsh-file-bottom-scroll::-webkit-scrollbar { height: 8px; } .dsh-file-bottom-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-primary, #ccc); border-radius: 4px; } .dsh-file-bottom-scroll::-webkit-scrollbar-track { background: transparent; }'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, '@dsh-external/ui-file-browser: keyframes')

  ctx.effect(installWorkspaceButtons, '@dsh-external/ui-file-browser: workspace buttons')
  ctx.effect(installFileLinkInterceptor, '@dsh-external/ui-file-browser: file link interceptor')

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      id: '@dsh-external/ui-file-browser-directory',
      order: 100,
    }, DirectoryPanel),
  )

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'files',
      order: 20,
      label: () => '文件',
    }, FilesView),
  )
}
