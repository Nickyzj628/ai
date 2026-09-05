// ================================
// 全局配置：读写~/.@nickyzj2023/ai/config.json
// ================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Config = {
	baseUrl: string;
	apiKey: string;
	model: string;
};

/**
 * 获取全局配置文件路径（Windows/macOS/Linux通用）
 * @returns （Windows下）C:/Users/Administrator/.@nickyzj2023/ai/config.json
 */
export const getConfigPath = () => {
	return join(homedir(), ".@nickyzj2023", "ai", "config.json");
};

/**
 * 读取配置文件
 * @returns 正常返回Config，配置不存在或损坏时返回null
 */
export const loadConfig = () => {
	try {
		const config = JSON.parse(
			readFileSync(getConfigPath(), "utf8"),
		) as Partial<Config>;

		// 回避空/脏数据
		if (
			typeof config.baseUrl !== "string" ||
			typeof config.apiKey !== "string" ||
			typeof config.model !== "string"
		) {
			return null;
		}

		return config as Config;
	} catch {
		return null;
	}
};

/**
 * 将配置写回全局文件（自动创建目录）
 * @remarks 写入失败会抛异常
 */
export const saveConfig = (config: Partial<Config>) => {
	const configPath = getConfigPath();
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};
