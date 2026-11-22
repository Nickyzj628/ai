import type { Client } from "@modelcontextprotocol/sdk/client";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
	extractErrorMessage,
	isObject,
	logger,
	omit,
} from "@nickyzj2023/utils";
import type { ToolDefinition } from "../types.js";
import { defineTool } from "../utils/helper.js";

/** 全局单例MCP加载器 */
let router: MCPRouter | null = null;

/** listTools()返回的工具schema */
export type McpTool = Tool;

export type McpServer = {
	type: "streamable_http" | "sse";
	url: string;
	headers?: Record<string, any>;
	ignoredToolNames?: string[];
	/**
	 * 可选的listTools()结果，带了就直接当工具列表用，不再连服务器拉一遍
	 * @remarks 留给上层做工具缓存的“口子”（如CLI层的mcp-cache.json），普通用法不用管
	 */
	tools?: McpTool[];
};

/**
 * 懒加载SDK并建立到指定URL的连接，setup探测和正式加载共用
 * @param name 客户端名称
 * @param url MCP服务器地址
 * @param options headers与可选的超时信号
 * @returns 已连接的客户端
 */
const connectClient = async (
	name: string,
	url: string,
	options?: Omit<McpServer, "type" | "url"> & { signal?: AbortSignal },
) => {
	// 动态加载sdk：保持下游懒加载（不用到MCP就不加载283kb），也避免拖慢CLI启动
	const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
		import("@modelcontextprotocol/sdk/client"),
		import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
	]);

	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: { headers: options?.headers, signal: options?.signal },
	});
	const client = new Client({ name, version: "1.0.0" });
	await client.connect(transport);

	return client;
};

/**
 * 连上MCP服务器拉一次工具名后立刻断开，不注册到router
 * @param url MCP服务器地址
 * @param options headers等配置
 * @returns 该服务器提供的全部工具名
 */
export const listMcpToolNames = async (
	url: string,
	options?: Omit<McpServer, "type" | "url">,
) => {
	const client = await connectClient("ai-setup", url, options);
	try {
		const { tools } = await client.listTools();
		return tools.map((tool) => tool.name);
	} finally {
		await client.close().catch(() => {});
	}
};

/**
 * 把MCP的工具schema转成OpenAI API兼容的工具定义
 * @param tool listTools()返回的工具
 * @param execute 实际执行工具的函数
 */
const defineMcpTool = (tool: McpTool, execute: ToolDefinition["execute"]) => {
	const _properties = {
		...(tool.inputSchema.properties ?? {}),
	} as ToolDefinition["function"]["parameters"]["properties"];

	// 注入required bool语法糖
	tool.inputSchema.required?.forEach((key) => {
		if (isObject(_properties[key])) {
			_properties[key] = { ..._properties[key], required: true };
		}
	});

	return defineTool(tool.name, tool.description ?? "", _properties, execute);
};

/**
 * 连接相关的配置有没有变
 * @remarks tools只是缓存内容，不影响怎么连、连上之后能干嘛，比较时先剔掉
 */
const isSameServer = (a: McpServer, b: McpServer) => {
	return (
		JSON.stringify(omit(a, ["tools"])) === JSON.stringify(omit(b, ["tools"]))
	);
};

/** 单个MCP服务器的登记信息 */
type Entry = {
	/** 服务器配置（可能带着缓存来的tools） */
	server: McpServer;
	/** 工具列表，null表示还没加载过 */
	tools: ToolDefinition[] | null;
	/** 懒连接：第一次真正要用时才连 */
	client?: Promise<Client>;
};

export class MCPRouter {
	private entries = new Map<string, Entry>();

	/**
	 * 登记一个MCP服务器并备好它的工具
	 * @param onToolsListed 真的去服务器拉工具列表时的回调，上层凭它写缓存
	 * @remarks server.tools有值（缓存命中）就直接复用，一次网络请求都不发
	 */
	async addServer(
		name: string,
		server: McpServer,
		onToolsListed?: (name: string, tools: McpTool[]) => void,
	) {
		const entry = this.register(name, server);

		// 同一份配置已经加载过就直接用，别重复拉
		if (entry.tools) {
			return;
		}

		const listed = server.tools ?? (await this.listTools(name));
		onToolsListed?.(name, listed);

		const ignored = server.ignoredToolNames ?? [];
		entry.tools = listed
			.filter((tool) => !ignored.includes(tool.name))
			.map((tool) =>
				defineMcpTool(tool, (args) => this.callTool(name, tool.name, args)),
			);
	}

	/** 注册一个新的MCP客户端 */
	async addClient(
		name: string,
		url: string,
		options?: Omit<McpServer, "type" | "url">,
	) {
		await this.addServer(name, { type: "streamable_http", url, ...options });
		return this.getClient(name);
	}

	/** 返回OpenAI API兼容的tools数组 */
	async getTools() {
		return [...this.entries.values()].flatMap((entry) => entry.tools ?? []);
	}

	/** 登记配置：配置没变就复用，变了就换成全新的空壳 */
	private register(name: string, server: McpServer) {
		const entry = this.entries.get(name);
		if (entry && isSameServer(entry.server, server)) {
			return entry;
		}

		const fresh: Entry = { server, tools: null };
		this.entries.set(name, fresh);
		return fresh;
	}

	/** 连服务器拉一次工具列表（只有没带tools的服务器才走这里） */
	private async listTools(name: string) {
		const client = await this.getClient(name);
		const { tools } = await client.listTools();
		return tools;
	}

	/** 懒连接：同一个服务器只会连一次，连失败就清掉，下次还能重试 */
	private getClient(name: string) {
		const entry = this.entries.get(name);
		if (!entry) {
			throw new Error(`MCP服务器${name}未注册`);
		}

		entry.client ??= connectClient(
			name,
			entry.server.url,
			omit(entry.server, ["type", "url", "tools"]),
		).catch((e) => {
			entry.client = undefined;
			throw e;
		});

		return entry.client;
	}

	/** 调用MCP工具：连接在第一次调用时才建立 */
	private async callTool(name: string, toolName: string, args: any) {
		const client = await this.getClient(name);
		return client.callTool({ name: toolName, arguments: args });
	}
}

/**
 * 把传入的MCPServer列表转换成OpenAI API兼容的tools数组
 * @param onToolsListed 每个服务器成功拿到工具列表时的回调（命中缓存时不会触发）
 * @remarks 服务器配置里带了tools就直接复用，不连服务器
 */
export const loadMCPTools = async (
	mcpServers: Record<string, McpServer> = {},
	onToolsListed?: (name: string, tools: McpTool[]) => void,
) => {
	router ||= new MCPRouter();

	// 并发加载全部MCP工具，其中有失败的也不管
	await Promise.allSettled(
		Object.entries(mcpServers).map(async ([name, server]) => {
			try {
				await router?.addServer(name, server, onToolsListed);
			} catch (e) {
				logger(`MCP服务器${name}加载失败：${extractErrorMessage(e)}`);
			}
		}),
	);

	return router.getTools();
};
