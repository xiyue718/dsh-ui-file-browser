# @dsh-external/ui-file-browser

## Introduction

`ui-file-browser` is a file browser plugin for the DSH Web client. It adds an "Expand Directory" button to workspace rows, a "Files" navigation view to session windows, and supports browsing, opening, editing, previewing, renaming, deleting, and moving files.

## Installation

### Method 1: Super Module Injector

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser"}
```

Open or refresh DSH Web to use it.

### Method 2: dsh CLI (Official Project Way)

If you have the `dsh` CLI installed, follow the official project tutorial to install with `dsh plugin`:

```bash
# Install from a local plugin directory
dsh plugin --profile web add C:/Users/<user>/.dsh/plugins/ui-file-browser

# Or install from the GitHub repository
dsh plugin --profile web add github:xiyue718/dsh-ui-file-browser
```

Start after installation:

```bash
dsh --profile web
```

View the composed configuration:

```bash
dsh --profile web --dump-config
```

See the project documentation for details: `docs/user/develop/basic/publish.md`.

Build artifacts: host `lib/index.js`, client `lib/client.js`, package `dsh-external-ui-file-browser-0.1.0.tgz`.

## Usage

1. Start the DSH Web client.
2. Click the "Expand Directory" icon next to the "New Session" button in a workspace row to switch to the file navigation bar.
3. Single-click a file to select it; double-click a file to add it to the opened list and show its content.
4. Click "Files" in the session window's view navigation title to see the currently opened files and the active file content.
5. Edit text directly in the file content area, then click "Save" or press `Ctrl+S` / `Cmd+S` to write back to disk.
6. In the workspace file navigation bar, rename, delete, or long-press and drag to move files/folders.
7. File links from `edit` / `read` in the chat open directly inside the file navigation bar.

## Features

### 1. Workspace "Expand Directory" Button

- Adds an icon-only "Expand Directory" button next to the "New Session" button in each workspace row.
- Clicking it slides the workspace list left and slides the file navigation bar in from the right, switching between the workspace navigation bar and the file navigation bar.
- The file navigation bar has a "Back" button to return to the workspace list.
- This is not a popup; it is a page-switching animation inside the sidebar.
- The file navigation bar fills the entire sidebar workspace area and uses `--dsw-specific-sidebar-fill` to match the workspace navigation bar.

### 2. File Navigation Title

- Adds a "Files" entry in the session window's view navigation title area.
- The file view shows opened file tabs, the active file content, and supports closing opened files.

### 3. Workspace File Management

- Files/folders support rename, delete, and move.
- Rename and delete use the project's built-in dialogs instead of native browser `prompt` / `confirm`.
- Move is implemented by long-pressing and dragging to a target folder, with insertion position indicators.
- File selection styling matches the sidebar session selection styling.
- Text selection is disabled during long-press dragging.

### 4. Opening Chat File Links In-Place

- File links to local files in chat do not open external applications.
- Clicking a link opens the file directly inside the file navigation bar.
- If the current view is not "Files", it automatically switches to the "Files" navigation title.
- `edit` / `read` tool file links in chat are intercepted and opened inside the file navigation bar.
- `edit` / `read` links pointing outside the workspace can also be read and displayed directly (using the file's directory as the safe root).

### 5. Opened File List and Display Optimizations

- Only file names are shown; duplicate file names are displayed as `parent-directory/file-name`.
- When the list exceeds one row, it collapses by default and can be expanded/collapsed with an icon (no text).
- Fixed an issue where switching between opened files did not update the content.
- The file content area shows line numbers.
- Code content uses syntax highlighting: keywords, strings, comments, function names, and numbers use `--shiki-*` theme colors, matching chat code blocks.
- File tabs use type-based default colors: source, config, documentation, data, and other categories use different colors.
- Only the default theme is kept; no preset theme switching is provided.
- Workspace file navigation dynamically shows type-based icons with a visual style consistent with the project.
- The opened file list is persisted per workspace through the project storage domain; opened files survive switching sessions or view navigation within the same workspace.
- Workspace file navigation items support hover background highlighting.
- The file list uses `position: sticky` to stay fixed at the top.
- The horizontal scrollbar uses `position: fixed` below the file list, stays visible, and does not disappear when content scrolls.
- Each file remembers its horizontal/vertical scroll position and restores it when switching back.

### 6. Preview and Editing

- The session window file navigation supports previews:
  - Markdown files have three display modes: Editor, Editor & Preview, and Preview;
  - Image files are displayed as image previews.
- When the active file is `.md`, three mode icons appear on the right side of the file navigation bar; "Editor" is selected by default.
- The Markdown display mode is persisted through the project storage domain and survives refresh/reopen.
- The "Editor & Preview" mode shows a clear divider in the middle.
- Text/Markdown files are shown in an editable text box.
- Syntax highlighting is preserved while editing (transparent text over a highlighted background layer).
- The display font size is unified at `14px`.
- Only one vertical/horizontal scrollbar is kept to avoid duplicate scrollbars.

### 7. Interactions

- Folders are collapsed by default and can be expanded/collapsed by clicking.
- File list sorting: folders first, then files, each alphabetically.
- Icons use the project's consistent linear SVG style.
- Double-clicking a file while not in the "Files" view jumps directly to the file view and opens the file.

### Host API

```http
GET  /@dsh-external/ui-file-browser/api/workspaces
GET  /@dsh-external/ui-file-browser/api/tree?path=<workspace-path>
GET  /@dsh-external/ui-file-browser/api/file?root=<workspace-path>&path=<file-path>
POST /@dsh-external/ui-file-browser/api/write
POST /@dsh-external/ui-file-browser/api/rename
POST /@dsh-external/ui-file-browser/api/delete
POST /@dsh-external/ui-file-browser/api/move
GET  /@dsh-external/ui-file-browser/api/state?root=<workspace-path>
POST /@dsh-external/ui-file-browser/api/state
```

## How It Works

The plugin consists of a host half and a client half.

On the host side, it provides workspaces, directory tree, file read/write, rename, delete, move, and state persistence APIs through `webServer.register`. All file paths are validated with `ensureInside` to ensure the target is inside the workspace root and prevent unauthorized reads; single-file preview is limited to 1 MB, and directory scanning skips common large directories such as `.git`, `node_modules`, `dist`, `lib`, and `coverage`. Opened files and Markdown display modes are persisted through the storage domain.

On the client side, it handles UI rendering and interaction. Because the current host workspace row has no public button slot, the workspace row button is implemented with DOM injection. The file navigation bar is injected into the workspace navigation container; the workspace list slides left with `translateX(-100%)` and the file navigation bar slides in with `translateX(100%) → 0`, forming a real navigation switch. The session window file view is registered on `conversation.view` with id `files`. Syntax highlighting, the editing layer, preview modes, and scroll position memory are implemented in the client.

The "Session Message Navigation" feature has been extracted into the standalone `@dsh-external/ui-message-nav` plugin and is no longer included in this plugin.
