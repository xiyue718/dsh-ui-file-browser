[中文](./README.md) | [English](./README_EN.md)

# @dsh-external/ui-file-browser

## 介绍

`ui-file-browser` 是 DSH Web 客户端的文件浏览插件。它在工作区行内提供“展开目录”按钮，在会话窗口新增“文件”导航视图，并支持文件浏览、打开、编辑、预览、重命名、删除、移动等能力。

## 安装

### 方式一：超级模组注入器

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser"}
```

打开或刷新 DSH Web 后即可使用。

### 方式二：dsh 命令安装（项目官方方式）

如果你已安装 `dsh` CLI，可以按项目官方教程使用 `dsh plugin` 命令安装：

```bash
# 从本地插件目录安装
dsh plugin --profile web add C:/Users/<user>/.dsh/plugins/ui-file-browser

# 或从 GitHub 仓库安装
dsh plugin --profile web add github:xiyue718/dsh-ui-file-browser
```

安装后启动：

```bash
dsh --profile web
```

查看组合配置：

```bash
dsh --profile web --dump-config
```

详细命令说明见项目文档：`docs/user/develop/basic/publish.md`。

构建产物：host 为 `lib/index.js`，client 为 `lib/client.js`，打包文件为 `dsh-external-ui-file-browser-0.1.0.tgz`。

## 使用

1. 启动 DSH Web 客户端。
2. 在工作区行的“新建会话”按钮旁点击“展开目录”图标，切换到文件导航栏。
3. 单击文件仅选中；双击文件会加入已打开列表并显示内容。
4. 在会话窗口的视图导航标题中点击“文件”，可查看当前工作区已打开的文件列表和当前文件内容。
5. 在文件内容区域可直接编辑文本，点击“保存”或按 `Ctrl+S` / `Cmd+S` 写回磁盘。
6. 在工作区文件导航栏中可重命名、删除、长按拖动移动文件或文件夹。
7. 聊天窗口中的 `edit` / `read` 文件链接会自动在文件导航栏内部打开。

## 功能

### 1. 工作区“展开目录”按钮

- 在每个工作区行的“新建会话”按钮旁边添加一个仅图标的“展开目录”按钮。
- 点击后工作区列表向左滑出，文件导航栏从右侧滑入，相当于在工作区导航栏和文件导航栏之间切换。
- 文件导航栏提供“返回”按钮，可滑回工作区列表。
- 这不是弹窗，而是侧边栏内的页面切换动画。
- 文件导航栏占满整个侧边栏工作区区域，背景使用 `--dsw-specific-sidebar-fill`，与工作区导航栏视觉一致。

### 2. 文件导航标题

- 在会话窗口的视图导航标题区域新增“文件”入口。
- 文件视图显示已打开文件标签列表、当前打开文件的内容，并支持关闭已打开文件。

### 3. 工作区文件管理

- 文件/文件夹支持重命名、删除、移动。
- 重命名和删除使用项目内弹窗，不使用浏览器原生 `prompt` / `confirm`。
- 移动通过长按后拖动到目标文件夹实现，拖动时显示插入位置指示。
- 文件选中样式与侧边栏会话选中样式一致。
- 长按拖动时禁止文本选中。

### 4. 聊天文件链接内置打开

- 聊天窗口中指向本地文件的链接不会调用外部软件打开。
- 点击后会在文件导航栏内部直接打开该文件并展示内容。
- 如果当前不在“文件”视图，会自动切换到“文件”导航标题。
- 对话中的 `edit` / `read` 工具文件链接同样会拦截并在文件导航栏内部打开。
- `edit` / `read` 链接指向工作区外文件时也能直接读取并展示（以文件所在目录作为安全根目录）。

### 5. 已打开文件列表与显示优化

- 只显示文件名；多个同名文件时显示为“上级目录名/文件名”。
- 超过一行时默认收缩，可点击图标展开/收起（不显示文字）。
- 修复点击其他已打开文件时内容不更新的问题。
- 文件内容区域显示行号。
- 代码内容使用语法高亮：关键字、字符串、注释、函数名、数字等使用 `--shiki-*` 主题色，与对话视图代码块颜色一致。
- 文件标签按文件类型显示默认颜色：源代码、配置、文档、数据等分类使用不同颜色。
- 仅保留默认主题样式，不提供预设主题切换。
- 工作区文件导航栏根据文件类型动态显示对应图标，图标风格与项目整体视觉一致。
- 已打开文件列表按工作区通过项目 storage domain 持久化保存；同一工作区内切换会话或切换视图导航栏时，已打开文件不会丢失。
- 工作区文件导航中的文件项支持悬停背景高亮。
- 文件列表使用 `position: sticky` 固定在顶部。
- 文件内容横向滚动条使用 `position: fixed` 跟随文件列表下方位置，始终可见，不随内容滚动而消失。
- 每个文件会实时记住横向/纵向滚动位置，切换文件后再次返回时自动恢复。

### 6. 预览与编辑

- 会话窗口文件导航支持预览效果：
  - Markdown 文件提供三种显示模式：编辑器、编辑器与预览、预览；
  - 图片文件以图片预览显示。
- 当前文件为 `.md` 时，文件导航栏右侧显示三个模式图标，默认选中“编辑器”模式。
- Markdown 显示模式通过项目 storage domain 持久化保存，刷新/重开页面后保持上次选择。
- “编辑器与预览”模式中间显示清晰的分隔线。
- 文本/Markdown 文件以可编辑文本框显示。
- 编辑时保留语法高亮（透明文本 + 高亮背景层）。
- 显示字体大小统一为 `14px`。
- 仅保留一个纵向/横向滚动条，避免重复滚动条。

### 7. 交互

- 文件夹默认收缩，点击文件夹可展开/收起子目录。
- 文件列表排序：文件夹优先，其次文件，各自按字母序排列。
- 图标使用与项目一致的线性 SVG 风格。
- 在非“文件”视图时双击文件会立即跳转到文件视图并打开文件。

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

## 原理

插件由 host 和 client 两部分组成。

Host 侧通过 `webServer.register` 提供工作区、目录树、文件读取/写入、重命名、删除、移动和状态持久化 API。所有文件路径都会经过 `ensureInside` 校验，确保目标路径位于对应工作区根目录内，防止越权读取；单文件预览上限为 1 MB，目录扫描会跳过 `.git`、`node_modules`、`dist`、`lib`、`coverage` 等常见大目录。已打开文件和 Markdown 显示模式通过 storage domain 持久化保存。

Client 侧负责 UI 渲染与交互。由于当前主程序的工作区行没有公开的按钮插槽，工作区行按钮通过 DOM 注入实现；文件导航栏通过 DOM 注入到工作区导航容器内，工作区列表 `translateX(-100%)` 左滑移出，文件导航栏 `translateX(100%) → 0` 右侧滑入，形成导航栏切换。会话窗口的文件视图注册到 `conversation.view`，id 为 `files`。语法高亮、编辑层、预览模式、滚动位置记忆等都在 client 中实现。

“会话消息导航”功能已独立提取为 `@dsh-external/ui-message-nav` 插件，本插件不再包含该模块。
