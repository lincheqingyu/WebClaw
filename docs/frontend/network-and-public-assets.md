# 前端端口与 Public 资源说明

本文档说明本地开发时前后端端口的约定，以及 `frontend/public` 目录中静态图片资源的保留规则。

## 1. 端口配置

项目统一从仓库根目录的 `.env` 读取端口配置：

```bash
HOST=0.0.0.0
BACKEND_PORT=3011
FRONTEND_PORT=5173
```

含义如下：

- `BACKEND_PORT`：后端 HTTP / WebSocket 服务实际监听端口。
- `FRONTEND_PORT`：前端 Vite 开发服务和 `vite preview` 的展示端口。
- `HOST`：前后端开发服务共同使用的监听地址。

## 2. 生效规则

- 后端启动时读取根目录 `.env` 中的 `BACKEND_PORT`。
- 前端构建和开发时同样读取根目录 `.env`。
- 前端请求后端时，默认按“当前页面域名 + `BACKEND_PORT`”推导 API 和 WS 地址。
- 如果显式设置了 `BACKEND_ORIGIN`，则优先使用该地址，不再按端口自动推导。

## 3. 当前保留的 public 图片

`frontend/public` 当前只保留运行时实际使用的 4 张图片：

| 文件名 | 用途 |
|--------|------|
| `favicon.ico` | 浏览器根路径 favicon 兜底资源 |
| `lecquy-favicon-32.png` | 浏览器标签页 favicon |
| `lecquy-apple-touch-180.png` | Apple touch icon |
| `lecquy-mark-nobg.png` | 左侧栏品牌图（透明底） |

## 4. 清理规则

以下类型的图片不应继续放在 `frontend/public`：

- 仅用于设计中转、裁切或临时预览的源文件
- 已经没有运行时引用的旧 logo / mark 资源
- 仅用于手工生成 favicon 的大图源文件

如果后续需要替换图标，请直接覆盖当前保留的运行时文件，不要再把设计原图长期堆在 `frontend/public`。
