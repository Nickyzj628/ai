import type { Message } from "../../types.js";

/**
 * 校验assistant(tool_calls)消息
 */
export const isToolCalls = (message?: Message) => {
	return message?.role === "assistant" && Array.isArray(message.tool_calls);
};

/**
 * 校验多模态消息
 */
export const isMediaMessage = (message?: Message) => {
	const MEDIA_TYPES = ["image_url", "input_audio", "video_url"];

	return (
		message &&
		Array.isArray(message.content) &&
		message.content.some((part) => MEDIA_TYPES.includes(part.type))
	);
};

/**
 * 查找assistant(tool_calls) + tool配对组范围
 * @param messages 消息数组
 * @param toolIndex 组内任意tool消息下标
 * @returns 下标数组[组头assistant(tool_calls), 组内最后一个tool)，找不到组头时返回null
 */
export const findToolGroupRange = (
	messages: Message[],
	toolIndex: number,
): [number, number] | null => {
	// 找到组内第一个tool消息
	let groupStart = toolIndex;
	while (groupStart > 0 && messages[groupStart - 1]?.role === "tool") {
		groupStart--;
	}

	// 找不到assistant(tool_calls)组头时，让调用者自行兜底
	if (!isToolCalls(messages[groupStart - 1])) {
		return null;
	}

	// 找到组内最后一个tool消息
	let groupEnd = groupStart;
	while (groupEnd < messages.length && messages[groupEnd]?.role === "tool") {
		groupEnd++;
	}

	return [groupStart - 1, groupEnd];
};
