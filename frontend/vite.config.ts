/*
* Vite 是一个工厂流水线，plugins 就是流水线上的工位。原材料（你的 .tsx 文件）经过 react() 工位变成浏览器能懂的 JS，经过 tailwindcss() 工位把 flex、h-screen 这些类名变成真正的 CSS。
* */

import { defineConfig } from 'vite'        // Vite 提供的配置辅助函数
import react from '@vitejs/plugin-react'    // 让 Vite 能理解 JSX/TSX
import tailwindcss from '@tailwindcss/vite' // 让 Vite 能处理 Tailwind 类名

export default defineConfig({
    plugins: [
        react(),        // 插件1：处理 React 语法
        tailwindcss(),  // 插件2：扫描你代码里的 className，生成对应 CSS
    ],
})