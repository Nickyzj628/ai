// ================================
// CLI层专用：MCP工具缓存，读写~/.@nickyzj2023/ai/mcp-cache.json
// ================================
// 只有终端里的ai（setup/TUI）用这份缓存；在项目里import loadMCPTools完全不受影响，也不会去碰这个文件

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	extractErrorMessage,
	isObject,
	logger,
	omit,
} from "@nickyzj2023/utils";
import type { McpServer, McpTool } from "../tools/mcp.js";
import { loadMCPTools } from "../tools/mcp.js";
import { getMcpToolsCachePath } from "./config.js";

/** 缓存文件结构：按服务器名存配置快照和listTools()的结果 */
type McpToolsCache = Record<string, { server: McpServer; tools: McpTool[] }>;

/** 配置快照：剔掉tools，免得“缓存里存了什么”参与配置有没有变的比较 */
const toSnapshot = (server: McpServer) => omit(server, ["tools"]);

/** 两份服务器配置是否一致 */
const isSameServer = (a: McpServer, b: McpServer) => {
	return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * 读取缓存文件
 * @returns 缓存内容；文件不存在或读坏了都当空缓存，重新加载即可
 */
const readCache = (): McpToolsCache => {
	try {
		const cache = JSON.parse(
			readFileSync(getMcpToolsCachePath(), "utf8"),
		) as unknown;
		return isObject(cache) ? (cache as McpToolsCache) : {};
	} catch {
		return {};
	}
};

/**
 * 整份覆盖写回缓存文件
 * @remarks 写失败只记日志，大不了下次重新连一遍服务器
 */
const writeCache = (cache: McpToolsCache) => {
	try {
		const cachePath = getMcpToolsCachePath();
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
	} catch (e) {
		logger(`MCP工具缓存写入失败：${extractErrorMessage(e)}`);
	}
};

/**
 * 加载MCP工具并顺手维护缓存（CLI层用）
 * @remarks 服务器配置没变就直接用缓存里的工具列表，不连服务器；
 * 配置变过（setup里改的）或没有缓存的才真的去拉，拉到了才写进缓存
 */
export const loadCachedMCPTools = async (
	mcpServers: Record<string, McpServer> = {},
) => {
	const cache = readCache();
	const servers: Record<string, McpServer> = {};

	// 缓存和当前配置对得上就把工具列表带上，loadMCPTools看到它就不连服务器了
	for (const [name, server] of Object.entries(mcpServers)) {
		const snapshot = toSnapshot(server);
		const cached = cache[name];
		servers[name] =
			cached && isSameServer(cached.server, snapshot)
				? { ...snapshot, tools: cached.tools }
				: snapshot;
	}

	const tools = await loadMCPTools(servers, (name, listed) => {
		const server = servers[name];
		if (server) {
			cache[name] = { server: toSnapshot(server), tools: listed };
		}
	});

	// 只留当前配置里的服务器：删掉的、这次没拉成功的旧条目一并清掉
	const next: McpToolsCache = {};
	for (const [name, server] of Object.entries(servers)) {
		const entry = cache[name];
		if (entry && isSameServer(entry.server, toSnapshot(server))) {
			next[name] = entry;
		}
	}
	writeCache(next);

	return tools;
};
