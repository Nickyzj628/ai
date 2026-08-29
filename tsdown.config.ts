import { defineConfig } from "tsdown";

export default defineConfig({
	// index.ts 为库入口，cli.ts 为可执行入口，二者都要产出
	entry: ["src/index.ts", "src/cli.ts"],
	outDir: "dist",
	format: "esm",
	dts: true,
	platform: "node",
	// 显式生成 sourcemap：配合 field 便于用户调试；库代码不做压缩（压缩会丢失可读性）
	sourcemap: true,
	clean: true,
});
