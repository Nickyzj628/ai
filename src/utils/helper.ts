// ================================
// 通用的便捷方法
// ================================

import { fetcher } from "@nickyzj2023/utils";
import type { Message, Model, ToolDefinition } from "../types.js";

/**
 * 辅助定义一个POST /chat/completions支持的model参数
 * @remarks 只有baseUrl字段是必须的
 */
export const defineModel = (config: Model): Model => ({
	modalities: ["text"],
	context: 131072,
	...config,
});

/**
 * 辅助定义一个POST /chat/completions支持的tool对象
 * @param execute 实际执行工具的函数
 */
export const defineTool = (
	name: ToolDefinition["function"]["name"],
	description: ToolDefinition["function"]["description"],
	properties: ToolDefinition["function"]["parameters"]["properties"],
	execute: ToolDefinition["execute"],
): ToolDefinition => {
	// 收集property内部填写的required: true语法糖，推到外面的required数组
	const _required: string[] = [];
	const _properties = Object.entries(properties).reduce(
		(result, [key, property]) => {
			if ("required" in property) {
				_required.push(key);
				delete property.required;
			}
			result[key] = property;
			return result;
		},
		{} as Omit<
			ToolDefinition["function"]["parameters"]["properties"],
			"required"
		>,
	);

	return {
		type: "function",
		function: {
			name,
			description,
			parameters: {
				type: "object",
				properties: _properties,
				required: _required,
			},
		},
		execute,
	};
};

// 用Intl.Segmenter按词切分
const segmenter = new Intl.Segmenter([], { granularity: "word" });
export const estimateTextTokens = (text: string) => {
	let words = 0;
	let others = 0;
	for (const seg of segmenter.segment(text)) {
		if (seg.isWordLike) words++;
		else others++;
	}
	return Math.ceil(words * 1.5 + others / 4);
};

/**
 * 列出GET /models返回的模型id
 * @param baseUrl 接口前缀，如http://127.0.0.1:11434/v1
 * @param apiKey 本地llama.cpp等不校验鉴权的服务可以不传，不传就不带Authorization头
 * @returns 模型的id列表
 * @remarks 请求失败（服务没起、鉴权不过等）会抛异常，由调用方自行兜底
 */
export const listModels = async (baseUrl: string, apiKey?: string) => {
	const api = fetcher(baseUrl, {
		headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
	});

	// 各厂商/data[]里塞的东西差异很大，只取id，其余一概不碰
	const { data } = await api.get<{ data?: { id?: unknown }[] }>("/models");

	return (data ?? [])
		.map((model) => model.id)
		.filter((id): id is string => typeof id === "string");
};

/**
 * 根据上下文里的中/英文/多模态消息，估算出可能消耗的token
 * - 单词 ≈ 1.5token
 * - 标点/空白等非词字符每4个 ≈ 1token
 * - 图片/音频/视频/文件 ≈ 4096token（不好估算，取个较大的值）
 */
export const estimateTokens = (messages?: Message[]) => {
	if (!messages?.length) {
		return 0;
	}

	const tokens = messages.reduce((acc, message) => {
		const { content, tool_calls, ...metadata } = message;

		if (typeof content === "string") {
			acc += estimateTextTokens(content);
		} else {
			for (const part of content) {
				if (part.type === "text") {
					acc += estimateTextTokens(part.text);
				} else {
					acc += 4096;
				}
			}
		}

		if (tool_calls) {
			acc += estimateTextTokens(JSON.stringify(tool_calls));
		}
		acc += estimateTextTokens(JSON.stringify(metadata));

		return acc;
	}, 0);

	return tokens;
};
