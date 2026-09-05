// ================================
// ai setup：交互式配置BASE_URL / APIKEY / MODEL
// ================================

import readline from "node:readline";
import { extractErrorMessage } from "@nickyzj2023/utils";
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

	try {
		saveConfig({ baseUrl, apiKey, model });
		console.log(`配置已保存到${getConfigPath()}，直接运行ai即可开始对话`);
	} catch (e) {
		console.error(`保存配置失败：${extractErrorMessage(e)}`);
		process.exitCode = 1;
	}
}
