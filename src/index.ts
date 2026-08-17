/**
 * @dsh-external/ui-file-browser — host half.
 * Serves workspace directory listings and safe file reads for the browser UI.
 */
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'

export const name = '@dsh-external/ui-file-browser'
export const inject = ['webServer', 'workspaceRegistry', 'storageDomain']

const API_PREFIX = '/@dsh-external/ui-file-browser/api'
const WORKSPACES_PATH = '/@dsh-external/ui-file-browser/api/workspaces'
const TREE_PATH = '/@dsh-external/ui-file-browser/api/tree'
const FILE_PATH = '/@dsh-external/ui-file-browser/api/file'
const WRITE_PATH = '/@dsh-external/ui-file-browser/api/write'
const RENAME_PATH = '/@dsh-external/ui-file-browser/api/rename'
const DELETE_PATH = '/@dsh-external/ui-file-browser/api/delete'
const MOVE_PATH = '/@dsh-external/ui-file-browser/api/move'
const STATE_PATH = '/@dsh-external/ui-file-browser/api/state'
const MAX_FILE_BYTES = 1024 * 1024
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'lib', 'coverage', '.next', '.turbo'])

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

function isImageFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? ''
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  return IMAGE_MIME[ext] !== undefined
}

const fileBrowserStateSchema = zod.object({
  opened: zod.array(zod.string()),
  active: zod.string().nullable(),
  markdownMode: zod.enum(['editor', 'split', 'preview']).optional(),
})

const FILE_BROWSER_DOMAIN_SPEC = defineDomain({
  name: 'dsh_external_file_browser',
  version: 1,
  tables: {
    state: domainTable<string, zod.infer<typeof fileBrowserStateSchema>>(fileBrowserStateSchema),
  },
})

interface FileEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer | string) => { data += chunk })
    req.on('end', () => resolvePromise(data))
    req.on('error', reject)
  })
}

function ensureInside(root: string, target: string): string {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error('path escapes the workspace root')
  }
  return resolvedTarget
}

async function listTree(root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  async function walk(current: string): Promise<void> {
    let items: import('node:fs').Dirent[]
    try {
      items = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue
      const full = resolve(current, item.name)
      const rel = relative(root, full)
      try {
        const info = await stat(full)
        entries.push({
          path: full,
          name: rel.split(sep).join('/'),
          type: item.isDirectory() ? 'dir' : 'file',
          size: item.isDirectory() ? 0 : info.size,
          mtime: info.mtimeMs,
        })
      } catch {
        // Skip unreadable entries.
      }
      if (item.isDirectory()) await walk(full)
    }
  }
  await walk(root)
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

export async function apply(ctx: Context): Promise<void> {
  const storageDomain = (ctx as any).storageDomain
  let fileBrowserDomain: any
  if (storageDomain !== undefined) {
    try {
      fileBrowserDomain = await storageDomain.open(FILE_BROWSER_DOMAIN_SPEC)
      ctx.effect(() => () => { void fileBrowserDomain?.close?.() }, '@dsh-external/ui-file-browser: storage domain')
    } catch {
      fileBrowserDomain = undefined
    }
  }

  ctx.effect(() => (ctx as any).webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const pathname = url.pathname

      if (req.method === 'GET' && pathname === STATE_PATH) {
        const root = url.searchParams.get('root')
        if (typeof root !== 'string' || root === '') {
          sendJson(res, 400, { error: 'root is required' })
          return
        }
        const state = fileBrowserDomain?.table('state').get(root)
        sendJson(res, 200, {
          opened: state?.opened ?? [],
          active: state?.active ?? null,
          markdownMode: state?.markdownMode ?? 'editor',
        })
        return
      }

      if (req.method === 'POST' && pathname === STATE_PATH) {
        let body: any
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const root = body.root
        const opened = body.opened
        const active = body.active
        if (typeof root !== 'string' || root === '' || !Array.isArray(opened) || opened.some((item: any) => typeof item !== 'string')) {
          sendJson(res, 400, { error: 'root and opened are required' })
          return
        }
        const markdownMode = body.markdownMode === 'split' || body.markdownMode === 'preview' ? body.markdownMode : body.markdownMode === 'editor' ? 'editor' : undefined
        const next = {
          opened,
          active: typeof active === 'string' ? active : null,
          ...(markdownMode === undefined ? {} : { markdownMode }),
        }
        await fileBrowserDomain?.table('state').put(root, next)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && pathname === WORKSPACES_PATH) {
        try {
          const registry = (ctx as any).workspaceRegistry
          const workspaces = registry.list().map((workspace: any) => ({
            id: String(workspace.id),
            path: workspace.path,
            title: workspace.title,
          }))
          sendJson(res, 200, { workspaces })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { error: message })
        }
        return
      }

      if (req.method === 'GET' && pathname === TREE_PATH) {
        const root = url.searchParams.get('path')
        if (typeof root !== 'string' || root === '') {
          sendJson(res, 400, { error: 'path is required' })
          return
        }
        try {
          const entries = await listTree(root)
          sendJson(res, 200, { root, entries })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { error: message })
        }
        return
      }

      if (req.method === 'GET' && pathname === FILE_PATH) {
        const root = url.searchParams.get('root')
        const target = url.searchParams.get('path')
        if (typeof root !== 'string' || root === '' || typeof target !== 'string' || target === '') {
          sendJson(res, 400, { error: 'root and path are required' })
          return
        }
        try {
          const resolved = ensureInside(root, target)
          const info = await stat(resolved)
          if (!info.isFile()) {
            sendJson(res, 400, { error: 'path is not a file' })
            return
          }
          if (info.size > MAX_FILE_BYTES) {
            sendJson(res, 413, { error: 'file is too large to preview' })
            return
          }
          if (isImageFile(resolved)) {
            const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
            const mime = IMAGE_MIME[ext] ?? 'application/octet-stream'
            const buffer = await readFile(resolved)
            sendJson(res, 200, { path: resolved, kind: 'image', dataUrl: `data:${mime};base64,${buffer.toString('base64')}` })
            return
          }
          const content = await readFile(resolved, 'utf8')
          sendJson(res, 200, { path: resolved, kind: 'text', content })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { error: message })
        }
        return
      }

      if (req.method === 'POST' && pathname === WRITE_PATH) {
        let body: any
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const root = body.root
        const path = body.path
        const content = body.content
        if (typeof root !== 'string' || root === '' || typeof path !== 'string' || path === '' || typeof content !== 'string') {
          sendJson(res, 400, { error: 'root, path and content are required' })
          return
        }
        try {
          const resolved = ensureInside(root, path)
          await writeFile(resolved, content, 'utf8')
          sendJson(res, 200, { ok: true, path: resolved })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { error: message })
        }
        return
      }

      if (req.method === 'POST' && (pathname === RENAME_PATH || pathname === DELETE_PATH || pathname === MOVE_PATH)) {
        let body: any
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const root = body.root
        const path = body.path
        if (typeof root !== 'string' || root === '' || typeof path !== 'string' || path === '') {
          sendJson(res, 400, { error: 'root and path are required' })
          return
        }
        try {
          const resolved = ensureInside(root, path)
          if (pathname === RENAME_PATH) {
            const newName = body.newName
            if (typeof newName !== 'string' || newName.trim() === '' || newName.includes('/') || newName.includes('\\')) {
              sendJson(res, 400, { error: 'newName must be a non-empty file name' })
              return
            }
            const newPath = ensureInside(root, join(dirname(resolved), newName.trim()))
            await rename(resolved, newPath)
            sendJson(res, 200, { ok: true, path: newPath })
            return
          }
          if (pathname === DELETE_PATH) {
            const info = await stat(resolved)
            await rm(resolved, { recursive: info.isDirectory(), force: true })
            sendJson(res, 200, { ok: true })
            return
          }
          const destination = body.destination
          if (typeof destination !== 'string' || destination.trim() === '') {
            sendJson(res, 400, { error: 'destination is required' })
            return
          }
          const destinationDir = ensureInside(root, join(root, destination.trim()))
          const newPath = join(destinationDir, basename(resolved))
          await rename(resolved, newPath)
          sendJson(res, 200, { ok: true, path: newPath })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 500, { error: message })
        }
        return
      }

      sendJson(res, 404, { error: 'not found' })
    },
  }), '@dsh-external/ui-file-browser: api')
}
