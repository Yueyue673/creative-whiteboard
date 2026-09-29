# 参与开发

欢迎报告具体的操作问题。请附上复现步骤、预期结果、实际结果、系统与浏览器版本。截图请先去掉私人材料。

运行 `python server.py` 即可开始。后端使用 Python 标准库；前端是原生 HTML、CSS 和 JavaScript。`server.py` 管理白板，`assets.py` 管理文件，`workflow_backend.py` 管理搜索、历史和提案。

提交前运行 `python -m unittest discover -s tests -v`，并在浏览器实际检查相关操作。涉及缩放、拖动或剪贴板时，应覆盖编辑状态、不同缩放比例和多窗口。

不要提交 `data/`、本机素材索引、绝对私人路径、凭据或有权利限制的媒体。功能修改应适用于不同项目。
