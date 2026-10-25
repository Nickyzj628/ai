// ================================
// 仅在内部可用的便捷方法
// ================================

import type { Message, Usage } from "../types.js";
import { estimateTextTokens, estimateTokens } from "./helper.js";

const formatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** 把数字转换成千分位 */
export const humanizeNumber = (number: number) => {
	return formatter.format(number);
};

/**
 * 模型未返回用量时，本地估算一个
 * @param messages 当前上下文（调用模型前，即还未推入assistant回复）
 */
export const estimateFallbackUsage = (
	messages: Message[],
	content: string,
	reasoning: string,
): Usage => {
	const promptTokens = estimateTokens(messages.slice(-1));
	const completionTokens = estimateTextTokens(content + reasoning);
	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: estimateTokens(messages) + promptTokens + completionTokens,
	};
};

/** 按本轮耗时计算生成速度（tokens/s），直接修改并返回usage */
export const withSpeed = (usage: Usage, startTime: number): Usage => {
	usage.speed = Math.floor(
		usage.completion_tokens / ((Date.now() - startTime) / 1000),
	);
	return usage;
};
