# 发布构建

`npm run build` 先用 TypeScript 检查类型，再由 `scripts/build.mjs` 生成两个 ESM 入口。esbuild 将 MCP SDK、Zod、tiktoken 及实际使用的间接依赖打入入口文件。tiktoken 只包含 `o200k_base` 词表。

生产依赖只保留 `@napi-rs/canvas`，npm 按系统和 CPU 安装对应的原生库。`pagebraid-mcp` 和 `pagebraid-debug` 的启动方式保持不变。

## PDF.js 资源

`dist/pdfjs/` 包含官方 legacy 压缩版主模块和 worker，以及 `cmaps`、`standard_fonts`、`wasm`、`iccs` 目录。资源与各自的许可证一起原样复制。

构建将应用的 PDF.js 导入指向 `dist/pdfjs/pdf.mjs`。主模块与 worker 保持相邻，资源路径相对于发布入口解析。源码开发模式仍从本地 `node_modules/pdfjs-dist` 读取资源。Node 数据工厂需要文件系统路径，PDF.js 要求目录以 `/` 结尾，Windows 上也使用这个后缀。

PDF.js 和 tiktoken 固定版本。升级时检查资源文件、worker 加载方式，以及 `third-party/sources.json` 中的补充声明。

## 第三方声明

构建根据 esbuild 的输出记录，收集实际打入产物的包，并生成 `dist/THIRD_PARTY_NOTICES.txt`。包内的 LICENSE、NOTICE 和 COPYING 文件完整保留。缺少声明时构建失败。

`third-party/` 保存安装包缺少的许可文本，并在 `sources.json` 中记录来源及适用版本。目前包含 tiktoken 的上游许可证和 PDF.js legacy 内置的 core-js 许可证。更改对应依赖版本后，需要核对并更新这些记录；构建过程无需联网获取许可证。

MCP SDK 自带的许可迁移说明随完整 LICENSE 一起保留。PDF.js 字体、CMap 和解码器的许可证存放在相应资源目录。

## 验证发布包

```bash
npm ci
npm run check:package
npm pack --dry-run
```

`check:package` 构建并打包，在系统临时目录安装 tarball，然后运行安装后的调试 CLI。检查覆盖三种读取模式、中文 CMap、标准字体、扫描页、带空格和中文的文件路径，以及 manifest、文本和图像文件。JPEG2000 页按像素颜色验证 WASM 解码结果。测试也核对资源内容和第三方声明，结束后清理临时安装和输出。

新增或裁剪 PDF.js 解码资源时，另用对应格式的 PDF 跑调试 CLI，并检查渲染结果。CI 执行 `check:package` 和发布文件清单检查。

下载体积按 tarball 与平台生产依赖的压缩体积相加；`unpackedSize` 表示解压大小。安装后的 Canvas 版本由生产依赖范围决定，因此比较构建前后的下载量时应使用同一 Canvas 版本。
