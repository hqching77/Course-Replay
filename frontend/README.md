# Course Replay Frontend

第一阶段：课程首页与本地课程管理。当前分支 Charles。

## 启动

在 frontend 目录执行：

```sh
pnpm install
pnpm dev
```

使用终端打印的本地地址访问（通常为 http://127.0.0.1:5173；占用时 Vite 会使用其他端口）。支持 Node.js 22.12+。

不要双击 frontend/index.html，也不要使用 file:/// 地址打开源码。浏览器无法直接执行 React/TypeScript 源码，需要 Vite 转换并提供依赖。安装失败时必须先解决依赖下载，再启动预览。

```sh
pnpm typecheck
pnpm build
```

## 当前范围

- React、TypeScript、Vite 和 React Router。
- 课程创建、查看、编辑、删除，搜索、排序、网格与列表布局。
- localStorage 保存用户实际创建的课程；没有预填演示课程。
- 原生 dialog 支持 Escape 关闭和焦点约束。
- 读取失败时保留原始数据并禁止覆盖；写入失败时保留表单输入。
- 页面明确标注本地状态，未接入材料上传、AI、掌握度或服务器同步。
- 课程仓储独立于页面，后续可替换为 API 层。

## 后续阶段

对齐后端数据结构后实现材料上传与处理进度，再实现课堂重放三栏工作台。
不要把 API Key 放入前端或 VITE_ 环境变量。
