# 参与开发

欢迎报告具体的操作问题。请附上复现步骤、预期结果、实际结果、系统与浏览器版本。截图请先去掉私人材料。

运行 `python server.py` 即可开始。后端使用 Python 标准库；前端是原生 HTML、CSS 和 JavaScript。`server.py` 管理白板，`assets.py` 管理文件，`workflow_backend.py` 管理搜索、历史和提案。`experience.js` 统一内容拖放、默认尺寸、文件引用和任务回复入口。

提交前运行 `python -m unittest discover -s tests -v`，并在浏览器实际检查相关操作。涉及缩放、拖动或剪贴板时，应覆盖编辑状态、不同缩放比例和多窗口。

不要提交 `data/`、本机素材索引、绝对私人路径、凭据或有权利限制的媒体。功能修改应适用于不同项目。

## 浏览器操作回归

应用运行本身不需要 npm。开发时可以另外安装浏览器测试工具：

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

测试启动临时数据目录和独立服务端口，验证字号保存与阅读一致、三窗口复制、冲突保护、AI 范围限制和提案应用。也实际拖动内容到表格、内容库和另一侧白板，检查保存恢复、文件引用和重复上传。测试结束会清理自己的临时目录，不使用现有工作数据。

`PYTHON` 可指定 Python 可执行文件；`CHROME_PATH` 可指定已有 Chrome，否则使用 Playwright 的 Chromium。
