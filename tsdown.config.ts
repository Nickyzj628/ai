import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		// 库入口（barrel，便于一次性引入）
		"src/index.ts",
		// 细分入口：让消费方只取所需模块，避免把compact/内置工具一起加载
		"src/agent.ts",
		"src/llm.ts",
		"src/tools/index.ts",
		"src/tools/mcp.ts",
		"src/utils/compact/index.ts",
		// CLI 入口（独立产物，任何库入口都不会引用它）
		"src/cli.ts",
	],
	outDir: "dist",
	format: "esm",
	dts: true,
	platform: "node",
	clean: true,
	minify: true,
	// 保留源码目录结构：一个模块一个产物，模块图完全由import决定，
	// 库入口不会因为"共享chunk"把TUI/CLI代码连带打进来
	unbundle: true,
	root: "src",
	// 固定文件名，产物可diff、可缓存、堆栈可读
	hash: false,
});
