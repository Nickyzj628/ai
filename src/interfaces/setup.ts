// ================================
// ai setup：交互式配置BASE_URL / APIKEY / MODEL / MCP
// ================================

import readline from "node:readline";
import { extractErrorMessage, isObject } from "@nickyzj2023/utils";
import type { McpServer } from "../tools/mcp.js";
import { getConfigPath, loadConfig, saveConfig } from "../utils/config.js";

/**
 * 临时创建readline接口，问答结束就关闭
 * @param question 提问
 * @returns 用户输入的回答
 */
const ask = (question: string) => {
	return new Promise<string>((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
};

/** 一个MCP服务器配置外加其名称（存储时的key） */
type McpServerItem = McpServer & { name: string };

/**
 * 询问一个可留空的字段：回车或输入空白时沿用默认值
 * @param question 提问文案
 * @param fallback 默认值
 * @returns 用户输入，空白时返回默认值
 */
const askWithDefault = async (question: string, fallback?: string) => {
	return (await ask(question)).trim() || fallback;
};

/**
 * 交互式录入一个MCP服务器配置
 * @param current 编辑时传入现有服务器，回车表示沿用原值；只传name表示配置缺失、重新录入
 * @returns 录入完成的配置；名称/URL为空或类型非法时返回null
 */
const askMcpServer = async (
	current?: Partial<McpServer> & { name: string },
): Promise<McpServerItem | null> => {
	const name = await askWithDefault(
		`名称 [当前为${current?.name ?? "(新)"}]: `,
		current?.name,
	);
	if (!name) {
		console.log("名称不能为空，已取消");
		return null;
	}

	const defaultType = current?.type ?? "streamable_http";
	const typeInput = await askWithDefault(
		`类型 streamable_http/sse [当前为${defaultType}]: `,
		defaultType,
	);
	if (typeInput !== "streamable_http" && typeInput !== "sse") {
		console.log("类型无效，已取消");
		return null;
	}
	// 上面的校验已把typeInput收窄为这两个字面量
	const type = typeInput;

	const url = await askWithDefault(
		`URL [当前为${current?.url ?? "无"}]: `,
		current?.url,
	);
	if (!url) {
		console.log("URL不能为空，已取消");
		return null;
	}

	let headers = current?.headers;
	const headersInput = (
		await ask(
			`headers(JSON对象) [当前为${
				current?.headers ? JSON.stringify(current.headers) : "无"
			}]: `,
		)
	).trim();
	if (headersInput) {
		try {
			const parsed = JSON.parse(headersInput) as unknown;
			if (isObject(parsed)) {
				headers = parsed;
			} else {
				console.log("headers需为JSON对象，已回退到原先的值");
			}
		} catch {
			console.log("headers解析失败，已回退到原先的值");
		}
	}

	let ignoredToolNames = current?.ignoredToolNames;
	const ignoredInput = (
		await ask(
			`忽略的工具名(逗号分隔) [当前为${
				current?.ignoredToolNames?.join(",") ?? "无"
			}]: `,
		)
	).trim();
	if (ignoredInput) {
		ignoredToolNames = ignoredInput
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}

	return {
		name,
		type,
		url,
		...(headers ? { headers } : {}),
		...(ignoredToolNames?.length ? { ignoredToolNames } : {}),
	};
};

/**
 * 把菜单输入的数字解析成对应的服务器名称
 * @param input 用户输入的数字串
 * @param names 当前菜单的服务器名称列表
 * @returns 对应名称；非整数或越界返回undefined
 */
const pickServerName = (input: string, names: string[]) => {
	const index = Number(input) - 1;
	return Number.isInteger(index) ? names[index] : undefined;
};

/**
 * MCP配置菜单：列出现有服务器，数字键编辑、a键添加、d键删除、回车或q结束
 */
const configMcp = async (mcpServers: Record<string, McpServer>) => {
	while (true) {
		const names = Object.keys(mcpServers);
		console.log("\n当前MCP服务器：");
		if (names.length === 0) {
			console.log("（空）");
		} else {
			names.forEach((name, i) => {
				const server = mcpServers[name];
				console.log(
					`  ${i + 1}. ${name} ${
						server ? `(${server.type} ${server.url})` : "（配置缺失）"
					}`,
				);
			});
		}

		const choice = (
			await ask(
				"输入数字编辑对应服务器，a添加新服务器，d删除服务器，回车或q结束: ",
			)
		)
			.trim()
			.toLowerCase();

		if (!choice || choice === "q") {
			break;
		}

		switch (choice) {
			case "a": {
				const result = await askMcpServer();
				if (result) {
					mcpServers[result.name] = result;
				}
				break;
			}
			case "d": {
				// 删除不可逆，再输编号确认一次，防止删错
				const target = (await ask("输入要删除的服务器编号: ")).trim();
				const oldName = pickServerName(target, names);
				if (!oldName) {
					console.log("无效编号，请输入列表中的数字");
					break;
				}
				const confirm = (await ask(`确认删除${oldName}？(y/n): `))
					.trim()
					.toLowerCase();
				if (confirm === "y") {
					delete mcpServers[oldName];
					console.log(`已删除${oldName}`);
				} else {
					console.log("已取消删除");
				}
				break;
			}
			default: {
				// 配置可能被手改成null之类的脏数据：提示后进入重新录入，名称沿用
				const oldName = pickServerName(choice, names);
				if (oldName) {
					const server = mcpServers[oldName];
					if (!server) {
						console.log("该服务器配置缺失，将重新录入");
					}
					const result = await askMcpServer({ name: oldName, ...server });
					if (result) {
						if (result.name !== oldName) {
							console.log(`已重命名 ${oldName} -> ${result.name}`);
						}
						delete mcpServers[oldName];
						mcpServers[result.name] = result;
					}
				} else {
					console.log("无效选择，请输入列表中的数字、a、d或回车");
				}
				break;
			}
		}
	}
};

/**
 * setup入口：依次询问BASE_URL / MODEL / APIKEY，确认后写入全局配置
 */
export async function runSetup() {
	const config = loadConfig();

	if (config) {
		console.log(
			`当前配置：BASE_URL ${config.baseUrl}，` +
				`APIKEY ${config.apiKey}，` +
				`MODEL ${config.model}`,
		);
		console.log("直接回车可沿用当前值。\n");
	}

	const baseUrl =
		(await ask(`BASE_URL [当前为${config?.baseUrl}]: `)) || config?.baseUrl;

	const apiKey =
		(await ask(`APIKEY [当前为${config?.apiKey}]: `)) || config?.apiKey;

	const model =
		(await ask(`MODEL [当前为${config?.model}]: `)) || config?.model;

	// MCP配置：询问是否配置，确认后进入编辑菜单
	const mcpServers = { ...config?.mcpServers };
	const wantMcp = (await ask("是否配置MCP服务器？(y/n): "))
		.trim()
		.toLowerCase();
	if (wantMcp === "y") {
		await configMcp(mcpServers);
	}

	try {
		saveConfig({ baseUrl, apiKey, model, mcpServers });
		console.log(`配置已保存到${getConfigPath()}，直接运行ai即可开始对话`);
	} catch (e) {
		console.error(`保存配置失败：${extractErrorMessage(e)}`);
		process.exitCode = 1;
	}
}
