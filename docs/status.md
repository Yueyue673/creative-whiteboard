# 版本与进度

开始使用本机白板，下载默认分支即可。需要账号和工作区时，再阅读开发分支的托管说明。

| 入口 | 包含什么 | 目前状态 |
| --- | --- | --- |
| [默认分支 main](https://github.com/Yueyue673/creative-whiteboard/tree/main) | 原工作台：便签、媒体、表格、内容库、标签与分栏 | 本机使用入口，按仓库首页启动 |
| [开发分支](https://github.com/Yueyue673/creative-whiteboard/tree/codex/hosted-linux-checks) | 在同一套原工作台上集成账号、工作区、成员权限和托管服务，并继续改善创作流程 | [草稿 PR #1](https://github.com/Yueyue673/creative-whiteboard/pull/1)，尚未合并到 main |
| 资料对照候选 | 查看资料时保留正在写的原便签与文字撤销；可明确打开原白板 | 开发分支候选，完整检查与独立服务验收中；未并入默认版 |

开发分支中的账号与数据服务接入原 `shell.html` / `index.html` 工作台。早期简化编辑器属于旧入口，不能代表现在的默认界面或原工作台的能力。

查看托管方式，请阅读 [开发分支的托管说明](https://github.com/Yueyue673/creative-whiteboard/blob/codex/hosted-linux-checks/hosted/README.md)。运行检查通过、源码推送、程序部署和实体设备体验是不同的验收，不能互相代替。

## 使用边界

- 本机版保存到本机目录；私人桌面资料不会自动上传到托管服务。
- 开发中的周期接收用于获取另一设备已经保存的更新，不是逐字实时协作；同时保存仍需核对冲突。
- 外观、常用视角和部分阅读位置属于当前浏览器偏好，不能视为已同步。
- 触屏操作已有 Chromium 原生事件模拟检查；手机、平板、输入法及不同浏览器仍需分别做实体设备验收。

仓库首页截图取自默认分支的原程序，只使用 [公开示例](../examples/getting-started.json)。截图中的内容和排版用于演示，不包含私人白板、素材或账号信息。

[返回首页](../README.md) · [使用说明](usage.md)
