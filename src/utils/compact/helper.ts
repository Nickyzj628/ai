import type { Message } from "../../types.js";

/**
 * 判断消息是否为带有工具调用的 assistant 消息
 */
export const hasToolCalls = (message: Message | undefined) =>
	message?.role === "assistant" && Array.isArray(message.tool_calls);

/**
 * 查找tool消息所属的 assistant(tool_calls) + tool 配对组范围
 * @param messages 消息数组
 * @param toolIndex tool消息的索引
 * @returns 配对组范围 [startIndex, endIndex)（含组头assistant与其后连续的全部tool消息）；
 * 找不到配对组头时返回 null
 * @remarks 配对组约定：组头是assistant(tool_calls)，组内是紧随其后的连续tool消息。
 * 删除或切分tool消息时都应整组处理，否则会留下孤立消息导致OpenAI API返回400。
 * 组内任意一条tool消息都能定位到整组，供上层按整组范围批量操作
 */
export const findToolGroupRange = (
	messages: Message[],
	toolIndex: number,
): [number, number] | null => {
	// 组内连续tool消息往前推，组头应是assistant(tool_calls)
	let groupStart = toolIndex;
	while (groupStart > 0 && messages[groupStart - 1]?.role === "tool") {
		groupStart--;
	}

	// 找不到assistant(tool_calls)组头时返回null交给调用方兜底
	// （hasToolCalls已处理undefined，groupStart为0时同样安全）
	if (!hasToolCalls(messages[groupStart - 1])) {
		return null;
	}

	// 组尾：组头后连续的所有tool消息，组范围是 [组头, 组尾)
	let groupEnd = groupStart;
	while (groupEnd < messages.length && messages[groupEnd]?.role === "tool") {
		groupEnd++;
	}

	return [groupStart - 1, groupEnd];
};
