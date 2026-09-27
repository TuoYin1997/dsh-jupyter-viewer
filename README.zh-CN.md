# dsh-jupyter-viewer

[English](README.md) · **简体中文**

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里直接渲染 Jupyter
Notebook，不用再对着 `nbformat` JSON：真正的 `.ipynb` 预览，外加一个把 notebook 当内容读的
`read_notebook` 工具。

## 功能

**`.ipynb` 文档预览**，显示在右侧边栏的文档页签里。

- Markdown 单元格走产品自带的 GFM + KaTeX 渲染；代码单元格带语法高亮和 `In [n]` 计数器；输出按
  类型渲染 —— stdout/stderr（保留 ANSI 颜色）、执行结果、`text/html` 表格、图片、`text/latex`
  公式、`application/json`、错误回溯。
- 目录导航栏、带输出内高亮的查找、**查看原始 JSON**、单元格耗时、单元格标签，以及 Jupyter 的
  `collapsed` / `source_hidden` 标记。
- 相对路径图片（`![](figs/a.png)`）按 notebook 所在目录解析。
- 渲染器下拉里的 `Plain text` 仍在，作为逃生通道；notebook 渲染器是默认项。

**`read_notebook` 工具。** 模型拿到的是有上限的结构化摘要 —— 不是原始 JSON，也不是 base64 ——
会话里同时显示带 **Open in preview** 的 notebook 卡片。读 `.ipynb` 请用它代替 `read`。

## 安装

把包作为 bundle 安装，`cordis.patch.yml` 会自动接好 `jupyter-notebook` 这一行：

- **插件管理器** —— Settings → Plugins，或 `plugin_manager` 工具，用包名或本地安装路径。
- **手动加 profile 依赖** —— 先让 profile 能解析到这个包，再把 `cordis.patch.yml` 里的行复制到该
  profile 自己的 `cordis.patch.yml` 的 `insert` 列表。

Node 和浏览器两半都由这一行加载。如果你的部署不会重新扫描 profile patch，重启 Harness 并刷新页面一次。

## 分发

最省事的是 `npm publish`；否则 `npm pack` 产出同一个 tarball：

```bash
npm publish
npm pack                       # -> dsh-jupyter-viewer-0.1.0.tgz
```

接收方通过 Settings → Plugins（或 `plugin_manager` 的 `install_bundle`）安装，参数填 tarball 路径或
`github:TuoYin1997/dsh-jupyter-viewer`。用源码 checkout 时，让包能在 profile 的 `node_modules` 里被
解析（clone、拷贝或 junction），再手动加那一行。桌面版**没有 `dsh` CLI**，所以只有这几条路。

本包**没有任何运行时 npm 依赖**：浏览器那半只 require `react` 和
`@deepseek-ai/dsh-client-ui-primitives`，两者都由 web shell 注入；Node 那半只从包内导入
`src/notebook.js`。`lib/client.js` 是提交进仓库的构建产物 —— `prepack` 会跑
`build-client.mjs --check` 和测试套件，产物过期会让打包失败，而不是流到用户手里。

### 接收方检查清单

1. Harness 必须组装了文档预览（`ui-sidebar-documentpreview`，由 `dsh-web-app` 提供）。没有它时预览
   会退化成一条控制台警告，工具卡片仍然可用。
2. `jupyter-notebook` 这个 id 只能有一行占用 —— 要并行安装 fork 就先改掉。
3. 重载后确认两半都在：工具列表里有 `read_notebook`，客户端 `Slots` / `sidebar.right.tab.document`
   下的 `jupyter-notebook` 为 `active: true`。
4. **版本耦合。** 标签契约读自 DSH `0.1.7-rc.2`，也就是 `engines.dsh` 声明的版本。装完请跑
   `npm test`：会抛错的桩把这些契约写死了，Harness 改了契约会先让测试失败，而不是等到浏览器里崩。

## 上限

| 项目 | 数值 | 位置 |
|---|---|---|
| 摘要中的单元格数 | 200 | `LIMITS.cardMaxCells` |
| 摘要字符数 | 32768 | `LIMITS.cardMaxChars` |
| 摘要内嵌图片 | 64 KiB（更大的只保留字节数） | `LIMITS.cardEmbedImageMaxBytes` |
| 预览一次绘制的单元格 | 300（之后是 **Show all cells**） | `LIMITS.previewMaxCells` |
| 框架内渲染的 HTML 输出 | 512 KiB（更大则按文本渲染） | `LIMITS.previewMaxHtmlChars` |
| HTML 框架高度 | 按内容实测，上限为视口的 70% | `HTML_FRAME_*` |
| 图片输出高度 | 最多 70vh，且不会放大到超过原始尺寸 | `S.image` |
| 工具读取的 notebook 文件大小 | 32 MiB | `lib/index.js` |

`read_notebook` 接受 `file_path`、`cells`（`"1-5,8"`）、`include_outputs` 和 `max_chars`。

## 安全

`text/html` 输出属于不可信的 notebook 内容，渲染在 `<iframe sandbox="allow-same-origin">` 里，
**脚本保持禁用** —— 框架内的标记既不能执行、不能导航本页，也读不到本源的任何东西；唯一的授权是父页
面的读取权限，那是框架测高所必需的。SVG 走 `<img>`。路径鉴权归 `ctx.fs`，和内置 `read` 工具完全
一样。

## 已知限制

- **相对路径图片只在预览里解析，聊天卡片里不会。** `attachment:` 图片是例外 —— notebook 把它嵌在单元
  格里，所以卡片也能渲染。
- **HTML 输出里的相对 `src`/`href`/`srcset` 是被改写，而不是由框架解析的** —— 每个可寻址的引用都会拼
  接到 notebook 所在目录，并指向文件路由。
- **Widget 输出是占位符。** `application/vnd.jupyter.widget-view+json` 以及其他未排序的 MIME 类型只
  显示一行说明类型。
- **聊天卡片只显示小图。** 超过摘要预算的会显示为 "Image output (12.3 KiB); open the preview tab to
  view it"。
- **HTML 输出按设计就是惰性的。** 其中的脚本永不执行，所以依赖脚本的输出只显示静态标记。
- **错误回溯保留其框架配色。** Jupyter 会给回溯的框架着色，所以原始回溯与纯文本一并保留。
- **`nbformat` 3 的 notebook 会被转换，而不是拒绝。** 版本高于 4 的按 4 读取。
- **嵌套表格不展开。** `tableToTsv` 只转换第一个表格，也不展开 `colspan`/`rowspan`。

## 开发

```bash
node scripts/run-tests.mjs        # 全部测试，在本进程内
node scripts/build-client.mjs     # 重新生成 lib/client.js
node scripts/build-client.mjs --check
node --check lib/client.js
```

改 `src/notebook.js` 或 `src/client-ui.js` 后要重新构建 —— `lib/client.js` 是生成物，产物过期时
`--check` 会失败。`src/notebook.js` 是两半唯一的真源，所以预览和卡片不可能用不同方式解析同一个
notebook。

## 深入阅读

插件如何接入 Harness、渲染为什么这么实现、哪些方案被否掉了、测试能证明什么不能证明什么：
[docs/DESIGN.md](docs/DESIGN.md)（英文）。
