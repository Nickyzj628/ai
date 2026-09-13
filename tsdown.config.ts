import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts", "src/tools/mcp.ts"],
	outDir: "dist",
	format: "esm",
	dts: true,
	platform: "node",
	clean: true,
});
