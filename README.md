<h1>创作白板</h1>

把笔记、资料和表格摆在一起，拖动、连接，慢慢整理出自己的思路。

![创作白板：自由摆放便签，用连线和表格整理内容](docs/cover.png)

[开始使用](#开始使用) · [操作说明](docs/usage.md) · [查看完整界面](docs/overview.png) · [反馈问题](https://github.com/Yueyue673/creative-whiteboard/issues)

## 内容可以怎样摆放

**先写下来，再决定顺序。** 双击空白处写便签，直接编辑内容，拖动四角调整大小。把相关内容放在一起，用连线说明它们的关系。需要按行列整理时，可以换用表格；单元格里也能放多张图片。

**资料放在想法旁边。** 图片、音视频、本地 HTML 和 JSON 可以放进白板查看。视频记住播放进度，支持的文档记住阅读位置，方便下次接着看。

**用过的内容，还能继续用。** 内容库支持嵌套文件夹。可以收起一组内容，也可以只取出其中一块。复制选中的内容，切换白板后直接粘贴；组内连线一起保留。

## 开始使用

需要 **Python 3.10 或更新版本**，以及 Chrome 或 Edge。无需安装 Python 第三方依赖。

```sh
git clone https://github.com/Yueyue673/creative-whiteboard.git
cd creative-whiteboard
python server.py
```

在浏览器打开 **http://127.0.0.1:18746/**。如果系统使用 `python3`，将最后一行改为 `python3 server.py`。

不使用 Git 的话，也可以从仓库的 **Code → Download ZIP** 下载，解压后运行。Windows 用户安装好 Python 后，可以右键运行 `启动白板.ps1`。使用过程中保留服务终端；关闭它会停止服务。

首次打开是空白板。可以从一条便签开始，也可以下载 [示例白板](examples/getting-started.json)，拖入画布后试着移动、编辑和连接。示例只是演示，不会预设你的项目分类。

## 最常用的几个操作

| 操作 | 方法 |
| --- | --- |
| 写内容、改内容 | 双击空白处新建；双击便签编辑 |
| 移动画布 | 按住右键拖动，也支持中键 |
| 缩放白板 | Ctrl＋滚轮，围绕鼠标位置缩放 |
| 调整便签大小 | 拖动四角的方形手柄 |
| 连线 | 从边缘圆点拖向另一块内容；Esc 取消 |
| 跨白板复制 | Ctrl＋C，切换白板，Ctrl＋V |
| 撤销、搜索 | Ctrl＋Z、Ctrl＋K |
| 查看整张白板 | Shift＋1 |

粘贴时，鼠标在画布内就放在鼠标附近；在侧栏时放到画布中央。输入框中的复制粘贴仍用于编辑文字。

## 保存与 AI 整理

白板和内容库默认保存在本机 `data/` 文件夹。可直接备份该文件夹；引用在其他位置的媒体也需要单独备份。[查看文件位置与配置](docs/usage.md#文件位置与配置)。

需要 AI 帮忙时，可以导出内容，让 AI 整理成修改提案，再导入逐项查看、决定是否采用。工具本身不调用模型，也不会自动上传资料。[查看 AI 协作说明](docs/usage.md#ai-协作)。

## 使用前了解

- 当前是本机工具。双开可以分别工作、跨窗口复制，但不支持多人实时协作；同一白板发生修改冲突时会提示。
- 音视频播放取决于浏览器支持的格式。阅读位置保存在当前浏览器里；外部网站和部分动态网页无法恢复。
- 历史记录可以帮助恢复误操作，仍建议独立备份。服务没有远程访问鉴权，请勿直接开放到公网。
- Windows 与 Chrome 是主要的界面验证环境。自动检查覆盖 Windows、Linux 的 Python 3.10 与 3.13；其他桌面环境仍需实际验证。

更多信息：[使用说明](docs/usage.md) · [参与开发](CONTRIBUTING.md) · [安全说明](SECURITY.md)

---

Creative Whiteboard is a local-first canvas for notes, media and tables. It runs with Python’s standard library and a browser. The interface and documentation are currently in Chinese.

[MIT License](LICENSE) applies to the application and included examples. Imported media retains its original license.
