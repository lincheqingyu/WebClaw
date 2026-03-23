# Public 资源说明

`frontend/public` 只保留运行时会被浏览器直接访问的静态资源。

当前保留文件：

- `Designer-6_svg.svg`：当前桌面标签页使用的 SVG favicon
- `lecquy-mark-nobg.png`：左侧栏品牌图（透明底）

清理约定：

- 设计原图、裁切中间稿、临时预览图不要放在这里
- 未被页面或浏览器直接引用的旧图片要及时删除
- 需要替换图标时，直接覆盖现有运行时文件即可

更完整的端口与资源约定见：

- [`docs/frontend/network-and-public-assets.md`](../../docs/frontend/network-and-public-assets.md)
