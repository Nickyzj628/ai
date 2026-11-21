// ================================
// 仅在内部可用的便捷方法
// ================================

import type { Message, StreamEvent, ToolCall, Usage } from "../types.js";
import { estimateTextTokens, estimateTokens } from "./helper.js";

/** stream()对外输出的工具调用事件 */
type ToolCallEvent = Extract<StreamEvent, { type: "tool_call" }>;

/**
 * ToolCall -> tool_call事件：把id/name/args拍平成统一字段，其余厂商私有字段（如thought_signature）原样透传
 */
export const toToolCallEvent = ({
	id,
	function: fn,
	...extra
}: ToolCall): ToolCallEvent => ({
	// extra可能带着ToolCall的type: "function"，放到最前面让其被忽略
	...extra,
	type: "tool_call",
	id,
	name: fn.name,
	args: fn.arguments,
});

/**
 * tool_call事件 -> ToolCall：toToolCallEvent()的逆操作，把id/name/args还原成ToolCall结构
 */
export const toToolCall = ({
	id,
	name,
	args,
	...extra
}: ToolCallEvent): ToolCall => ({
	// extra可能带着原事件的type: "tool_call"，放到最前面让其被忽略
	...extra,
	id,
	type: "function",
	function: { name, arguments: args },
});

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
