// ================================
// 产物边界检查：库入口的模块图里绝不能出现 CLI / TUI 等界面代码
// 用法：node scripts/check-dist.mjs
// ================================

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

/** 库入口（消费方 import 时可能加载的起点） */
const ENTRIES = [
	"index.mjs",
	"agent.mjs",
	"llm.mjs",
	"tools/index.mjs",
	"tools/get-time.mjs",
	"tools/get-weather.mjs",
	"tools/mcp.mjs",
	"utils/compact/index.mjs",
];

/** 被禁止进入库模块图的相对产物路径 */
const FORBIDDEN_FILES = [/^cli\.mjs$/, /^interfaces\//];

/** 被禁止进入库模块图的外部依赖（界面 / 进程相关） */
const FORBIDDEN_SPECIFIERS = [
	"@wterm/markdown",
	"node:readline",
	"node:readline/promises",
	"node:child_process",
];

const IMPORT_RE =
	/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 静态解析一个产物文件的依赖（相对路径 + 外部裸模块） */
const parseImports = (file) => {
	const source = readFileSync(resolve(DIST, file), "utf8");
	return [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]);
};

const visited = new Set();
const queue = [...ENTRIES];
/** 外部依赖 → 引用它的产物文件 */
const externals = new Map();

while (queue.length > 0) {
	const file = queue.pop();
	if (visited.has(file)) continue;
	visited.add(file);

	let imports;
	try {
		imports = parseImports(file);
	} catch {
		throw new Error(`产物缺失：dist/${file}（先执行 pnpm build）`);
	}

	for (const spec of imports) {
		if (spec.startsWith(".")) {
			// 产物内部引用均为带扩展名的相对路径
			const target = relative(
				DIST,
				resolve(DIST, dirname(file), spec),
			).replaceAll("\\", "/");
			queue.push(target);
			continue;
		}
		const owners = externals.get(spec) ?? [];
		owners.push(file);
		externals.set(spec, owners);
	}
}

const errors = [];

for (const file of visited) {
	if (FORBIDDEN_FILES.some((re) => re.test(file))) {
		errors.push(`库模块图里混入了界面/CLI 产物：dist/${file}`);
	}
}

for (const spec of FORBIDDEN_SPECIFIERS) {
	const owners = externals.get(spec);
	if (owners) {
		errors.push(
			`库模块图里引用了 ${spec}（来源：${owners.map((f) => `dist/${f}`).join("、")}）`,
		);
	}
}

if (errors.length > 0) {
	console.error("✖ 产物边界检查失败：");
	for (const error of errors) console.error(`  - ${error}`);
	process.exit(1);
}

console.log(
	`✔ 产物边界检查通过：库入口共 ${visited.size} 个产物文件，未引入 CLI/TUI（${[...externals.keys()].filter((s) => !s.startsWith("node:")).join(", ")}）`,
);
