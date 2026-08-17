# @dsh-external/ui-file-browser

DSH Web 文件浏览插件：在工作区行内提供“展开目录”按钮，并在会话窗口新增“文件”导航视图。

## 功能

### 1. 工作区“展开目录”按钮

- 在每个工作区行的“新建会话”按钮旁边添加一个仅图标的“展开目录”按钮。
- 点击后工作区列表向左滑出，文件导航栏从右侧滑入，相当于在工作区导航栏和文件导航栏之间切换。
- 文件导航栏提供“返回”按钮，可滑回工作区列表。
- 这不是弹窗，而是侧边栏内的页面切换动画。
- 文件导航栏占满整个侧边栏工作区区域，背景使用 `--dsw-specific-sidebar-fill`，与工作区导航栏视觉一致。

### 2. 文件导航标题

- 在会话窗口的视图导航标题区域新增“文件”入口。
- 文件视图只显示：
  - 已打开文件标签列表；
  - 当前打开文件的内容；
  - 每个已打开文件支持关闭。

### 3. 工作区文件管理

- 工作区文件导航栏中的文件/文件夹支持：
  - 重命名（项目内弹窗，非浏览器 prompt）；
  - 删除（项目内确认弹窗，非浏览器 confirm）；
  - 移动（长按文件/文件夹后拖动到目标文件夹）。
- 文件选中样式与侧边栏会话选中样式一致。
- 弹窗通过 Portal 渲染在整个页面中心。
- 长按拖动时禁止文本选中。
- 拖动到目标文件夹时显示高亮/描边指示，与会话拖动的视觉反馈风格一致。

### 4. 聊天文件链接内置打开

- 聊天窗口中指向本地文件的链接不会调用外部软件打开。
- 点击后会在文件导航栏内部直接打开该文件并展示内容。
- 如果当前不在“文件”视图，会自动切换到“文件”导航标题。
- 对话中的 `edit` / `read` 工具文件链接同样会拦截，并在文件导航栏内部打开。

### 5. 已打开文件列表优化

- 只显示文件名；多个同名文件时显示为“上级目录名/文件名”。
- 超过一行时默认收缩，可点击图标展开/收起（不显示文字）。
- 工作区文件导航栏的“返回”也使用图标按钮，不显示文字。
- 修复点击其他已打开文件时内容不更新的问题。
- 文件内容区域显示行号，便于定位。
- 代码内容使用语法高亮：关键字、字符串、注释、函数名、数字等使用 `--shiki-*` 主题色，与对话视图代码块颜色一致。
- 文件标签按文件类型显示默认颜色：源代码、配置、文档、数据等分类使用不同颜色。
- 仅保留默认主题样式，不提供预设主题切换。
- 工作区文件导航栏根据文件类型动态显示对应图标（源代码、配置、文档、数据、普通文件），图标风格与项目整体视觉一致。
- 已打开文件列表按工作区通过项目 storage domain 持久化保存；同一工作区内切换会话或切换视图导航栏时，已打开文件不会丢失。
- 工作区文件导航中的文件项支持悬停背景高亮，与项目工作区现有交互样式一致。
- 文件列表使用 `position: sticky` 固定在顶部。
- 文件内容横向滚动条使用 `position: fixed` 跟随文件列表下方位置，始终可见，不随内容滚动而消失。
- 每个文件会实时记住横向/纵向滚动位置，切换文件后再次返回时自动恢复。
- 会话窗口文件导航支持预览效果：
  - Markdown 文件提供三种显示模式：编辑器、编辑器与预览、预览；
  - 图片文件以图片预览显示。
- 文件内容支持直接编辑：
  - 文本/Markdown 文件以可编辑文本框显示；
  - 编辑时保留语法高亮（透明文本 + 高亮背景层）；
  - 点击“保存”或按 `Ctrl+S` / `Cmd+S` 写回磁盘；
  - 显示字体大小统一为 `14px`；
  - 仅保留一个纵向/横向滚动条，避免重复滚动条。
- 当前文件为 `.md` 时，文件导航栏右侧显示三个模式图标，默认选中“编辑器”模式。
- Markdown 显示模式通过项目 storage domain 持久化保存，刷新/重开页面后保持上次选择。
- “编辑器与预览”模式中间显示清晰的分隔线。
- 在文件导航栏中双击文件会立即切换到“文件”视图并打开文件。
- `edit` / `read` 链接指向工作区外文件时也能直接读取并展示（以文件所在目录作为安全根目录）。

### 6. 交互

- 文件夹默认收缩，点击文件夹可展开/收起子目录。
- 文件列表排序：文件夹优先，其次文件，各自按字母序排列。
- **单击文件**：仅选中该文件。
- **双击文件**：将该文件加入已打开列表，设为当前打开文件并显示内容。
- 图标使用与项目一致的线性 SVG 风格（当前色描边、圆角端点）。

## 说明

“会话消息导航”功能已独立提取为 `@dsh-external/ui-message-nav` 插件，本插件不再包含该模块。

## 安全说明

- 文件读取会校验目标路径必须位于对应工作区根目录内，防止越权读取。
- 单文件预览上限为 1 MB，超大文件会返回“文件过大”提示。
- 目录扫描会跳过 `.git`、`node_modules`、`dist`、`lib`、`coverage` 等常见大目录，避免卡顿。

## 实现说明

- 工作区行按钮通过浏览器 DOM 注入实现（当前主程序的工作区行没有公开的按钮插槽），插件卸载时会自动移除注入按钮。
- 文件导航栏通过 DOM 注入到工作区导航容器内，工作区列表 `translateX(-100%)` 左滑移出，文件导航栏 `translateX(100%) → 0` 右侧滑入，形成真正的导航栏切换。
- `shell.overlay` 仅作为找不到导航容器时的降级方案。
- 文件视图注册到 `conversation.view`，id 为 `files`。

## Host API

```http
GET  /@dsh-external/ui-file-browser/api/workspaces
GET  /@dsh-external/ui-file-browser/api/tree?path=<workspace-path>
GET  /@dsh-external/ui-file-browser/api/file?root=<workspace-path>&path=<file-path>
POST /@dsh-external/ui-file-browser/api/rename
POST /@dsh-external/ui-file-browser/api/delete
POST /@dsh-external/ui-file-browser/api/move
GET  /@dsh-external/ui-file-browser/api/state?root=<workspace-path>
POST /@dsh-external/ui-file-browser/api/state
```

## 安装到其他 DSH 客户端

### 方式一：超级模组注入器（推荐）

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser"}
```

然后打开/刷新 DSH Web。

### 方式二：本地 bundle 装配

```text
dev_install_package {
  "dir": "C:/Users/<user>/.dsh/plugins/ui-file-browser",
  "profile": "web"
}
```

### 方式三：手动 bundle 配置

将插件目录放入目标 DSH 可解析位置，在 profile 的 `package.json` 中声明依赖和 `bundles` 条目，然后重启 DSH Web。

## 构建产物

- host：`lib/index.js`
- client：`lib/client.js`
- 打包文件：`dsh-external-ui-file-browser-0.0.1.tgz`
