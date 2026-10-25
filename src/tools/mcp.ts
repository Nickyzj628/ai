import type { Client } from "@modelcontextprotocol/sdk/client";
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

export type McpServer = {
	type: "streamable_http" | "sse";
	url: string;
	headers?: Record<string, any>;
	ignoredToolNames?: string[];
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

export class MCPRouter {
	private entries = new Map<
		string,
		{ client: Client; tools: ToolDefinition[] }
	>();

	/** 注册一个新的MCP客户端 */
	async addClient(
		name: string,
		url: string,
		options?: Omit<McpServer, "type" | "url">,
	) {
		// 已经注册过的MCP不再处理
		if (this.entries.has(name)) {
			return;
		}

		const client = await connectClient(name, url, options);

		// 建立“MCP名称-[客户端, 工具列表]”映射
		const { tools } = await client.listTools();
		const normalizedTools = tools
			.filter((tool) => !options?.ignoredToolNames?.includes(tool.name))
			.map((tool) => {
				const _properties = {
					...(tool.inputSchema.properties ?? {}),
				} as ToolDefinition["function"]["parameters"]["properties"];

				// 注入required bool语法糖
				tool.inputSchema.required?.forEach((key) => {
					if (isObject(_properties[key])) {
						_properties[key] = { ..._properties[key], required: true };
					}
				});

				return defineTool(
					tool.name,
					tool.description ?? "",
					_properties,
					(args) =>
						client.callTool({
							name: tool.name,
							arguments: args,
						}),
				);
			});
		this.entries.set(name, { client, tools: normalizedTools });

		return client;
	}

	/** 返回OpenAI API兼容的tools数组 */
	async getTools() {
		return [...this.entries.values()].flatMap((e) => e.tools);
	}
}

/**
 * 把传入的MCPServer列表转换成OpenAI API兼容的tools数组
 */
export const loadMCPTools = async (
	mcpServers: Record<string, McpServer> = {},
) => {
	router ||= new MCPRouter();

	// 并发加载全部MCP工具，其中有失败的也不管
	await Promise.allSettled(
		Object.entries(mcpServers).map(async ([name, server]) => {
			try {
				await router?.addClient(
					name,
					server.url,
					omit(server, ["type", "url"]),
				);
			} catch (e) {
				logger(`MCP服务器${name}加载失败：${extractErrorMessage(e)}`);
			}
		}),
	);

	return router.getTools();
};
