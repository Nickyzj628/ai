import { createXMLText, logger } from "@nickyzj2023/utils";
import { runAgent } from "../../agent.js";
import type { Message } from "../../types.js";
import {
	findToolGroupRange,
	hasToolCalls,
	isSummarizableMessage,
} from "./helper.js";
import type { Compact } from "./types.js";

export const softDeleteToolResults = (
	messages: Message[],
	replacer: Compact.ReplacerOfToolResultContent,
): Message[] => {
	// 传入的messages是顶层切分后的"可压缩区"（已排除倒数keepCount条），全量处理即可
	// 注意：软删除只替换content不删除消息，不会拆散assistant(tool_calls) + tool配对组
	// 返回被软删的消息引用，供后续hardDeleteSoftMessages按引用识别残留
	const softDeleted: Message[] = [];
	for (const message of messages) {
		if (message?.role === "tool") {
			message.content = replacer(message.content);
			softDeleted.push(message);
		}
	}

	if (softDeleted.length > 0) {
		logger(`软删除了${softDeleted.length}条工具调用结果消息`);
	}
	return softDeleted;
};

export const softDeleteOldMediaMessages = (
	messages: Message[],
	replacer: Compact.ReplacerOfMediaContent,
): Message[] => {
	const mediaTypes = ["image_url", "input_audio", "video_url"];

	// 传入的messages是顶层切分后的"可压缩区"（已排除倒数keepCount条），全量处理即可
	// 返回被软删的消息引用，供后续hardDeleteSoftMessages按引用识别残留
	const softDeleted: Message[] = [];
	for (const message of messages) {
		if (
			message &&
			Array.isArray(message.content) &&
			message.content.some((part) => mediaTypes.includes(part.type))
		) {
			message.content = replacer(message.content);
			softDeleted.push(message);
		}
	}

	if (softDeleted.length > 0) {
		logger(`软删除了${softDeleted.length}条旧图片/音频/视频消息`);
	}
	return softDeleted;
};

/**
 * 清理软删除后残留的占位消息（信息在软删除时已丢失，此时删除不损失任何额外信息）
 * @param messages 可压缩区消息数组，直接原地删除
 * @param softDeleted 本轮被软删过的消息引用集合
 * @remarks
 * tool消息不能单独删除：OpenAI API要求assistant(tool_calls)与tool消息按tool_call_id配对，
 * 单独删掉tool会让assistant(tool_calls)变成孤立消息，后续请求返回400。
 * 因此遇到被软删的tool消息时，必须把整个assistant(tool_calls) + tool配对组一起删除。
 * 组内多条tool被软删时，集合去重后只会删除一次。
 */
export const hardDeleteSoftMessages = (
	messages: Message[],
	softDeleted: ReadonlySet<Message>,
) => {
	// 先收集要删除的索引，最后统一从后往前splice，避免逐个删除导致索引偏移
	const deleteIndices = new Set<number>();

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message || !softDeleted.has(message)) {
			continue;
		}

		if (message.role === "tool") {
			// tool消息不能单独删除，连同整个assistant(tool_calls)配对组一起删除
			// （配对组范围由findToolGroupRange统一计算，与其他调用方共用同一约定）
			const range = findToolGroupRange(messages, i);
			if (range) {
				const [start, end] = range;
				for (let k = start; k < end; k++) {
					deleteIndices.add(k);
				}
			} else {
				// 防御性兜底：正常数据流中tool必有配对组头，理论不会走到
				deleteIndices.add(i);
			}
		} else {
			// 普通消息（如被软删的媒体user消息）没有配对约束，直接删除
			deleteIndices.add(i);
		}
	}

	// 从后往前删除，避免索引偏移
	const sortedIndices = [...deleteIndices].sort((a, b) => b - a);
	for (const index of sortedIndices) {
		if (index !== undefined) {
			messages.splice(index, 1);
		}
	}

	if (deleteIndices.size > 0) {
		logger(`清理了${deleteIndices.size}条软删除残留消息`);
	}
};

export const summarizeMessages = async (
	messages: Message[],
	options: Compact.SummarizeOptions,
) => {
	const { model, systemPrompt } = options ?? {};

	// 传入的messages是顶层切分后的"可压缩区"（已排除倒数keepCount条，
	// 且切点已对齐到配对组边界，不会拆散assistant(tool_calls) + tool配对组），无需再计算边界

	// 消息太少时不需要总结
	if (messages.length === 0) {
		logger("消息太少，无需总结");
		return;
	}

	// 收集可以被总结的消息
	// - 跳过系统消息
	// - 跳过content含有第三方XML标签的消息（允许纯文本、<summary>标签、多模态消息）
	const summarizableIndices: number[] = [];
	const summarizingMessages: Message[] = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message) {
			continue;
		}

		// assistant(tool_calls) + tool配对组需整体可总结，避免拆散导致API 400
		if (hasToolCalls(message)) {
			let j = i + 1;
			while (j < messages.length && messages[j]?.role === "tool") {
				j++;
			}
			const group = messages.slice(i, j);
			if (group.every(isSummarizableMessage)) {
				for (let k = i; k < j; k++) {
					summarizableIndices.push(k);
				}
				summarizingMessages.push(...group);
			}
			i = j - 1;
			continue;
		}

		// 跳过孤立的tool消息（已由配对组逻辑处理）
		if (message.role === "tool") {
			continue;
		}

		if (isSummarizableMessage(message)) {
			summarizableIndices.push(i);
			summarizingMessages.push(message);
		}
	}

	if (summarizableIndices.length === 0) {
		logger("没有可总结的消息");
		return;
	}

	summarizingMessages.push(
		{ role: "system", content: systemPrompt },
		{ role: "user", content: "开始总结" },
	);

	let summarized = "";
	for await (const e of runAgent(model, summarizingMessages, [])) {
		if (e.type === "content_delta") {
			summarized += e.delta;
		}
	}

	// 替换原始消息数组中被总结的消息
	// 从后往前删除以避免索引偏移，在首个被总结消息的位置插入摘要
	const firstIndex = summarizableIndices[0] ?? 0;
	for (let i = summarizableIndices.length - 1; i >= 0; i--) {
		const index = summarizableIndices[i];
		if (index !== undefined) {
			messages.splice(index, 1);
		}
	}
	messages.splice(firstIndex, 0, {
		role: "user",
		content: createXMLText("summary", summarized),
	});
};

export const hardDeleteOldMessages = (messages: Message[]) => {
	// 传入的messages是顶层切分后的"可压缩区"（已排除倒数keepCount条）
	// 从第一条user消息开始删除，保留开头的system消息
	const startIndex = messages.findIndex((message) => message.role === "user");

	// 压缩区里没有user消息时，没有可删除的余量
	if (startIndex < 0) {
		logger("消息太少，无需硬删除");
		return;
	}

	const deletedCount = messages.length - startIndex;
	messages.splice(startIndex, deletedCount);
	logger(`硬删除了${deletedCount}条较早的消息`);
};
