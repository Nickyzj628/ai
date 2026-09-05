import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { extractErrorMessage, isObject, omit } from "@nickyzj2023/utils";
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

		const transport = new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: options?.headers },
		});
		const client = new Client({ name, version: "1.0.0" });
		await client.connect(transport);

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
export const loadMCPTools = async (mcpServers: Record<string, McpServer>) => {
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
				console.log(`已加载MCP工具：${name}`);
			} catch (e) {
				console.error(
					`MCP服务器${name}连接失败，跳过：${extractErrorMessage(e)}`,
				);
			}
		}),
	);

	return router.getTools();
};
