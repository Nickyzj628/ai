// ================================
// 通用的便捷方法
// ================================

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

/**
 * 根据上下文里的中/英文/多模态消息，估算出可能消耗的token
 * - 单词 ≈ 1.5token
 * - 标点/空白等非词字符每 4 个 ≈ 1token
 * - 图片/音频/视频/文件 ≈ 4096token（不好估算，取个较大的值）
 */
export const estimateTokens = (messages?: Message[]) => {
	if (!messages?.length) {
		return 0;
	}

	// 用Intl.Segmenter按词切分
	const segmenter = new Intl.Segmenter([], { granularity: "word" });
	const estimateTextTokens = (text: string) => {
		let words = 0;
		let others = 0;
		for (const seg of segmenter.segment(text)) {
			if (seg.isWordLike) words++;
			else others++;
		}
		return Math.ceil(words * 1.5 + others / 4);
	};

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
