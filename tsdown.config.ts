import { defineConfig } from "tsdown";

export default defineConfig({
	// index.ts 为库入口，cli.ts 为可执行入口，二者都要产出
	entry: ["src/index.ts", "src/cli.ts"],
	outDir: "dist",
	format: "esm",
	dts: true,
	platform: "node",
	clean: true,
});
