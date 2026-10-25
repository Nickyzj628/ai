import { createXMLText, logger } from "@nickyzj2023/utils";
import { nonStream } from "../../llm.js";
import type { Message, Model, Usage } from "../../types.js";
import { estimateFallbackUsage, withSpeed } from "../internalHelper.js";
import { findToolGroupRange, isMediaMessage } from "./helper.js";
import type { Compact } from "./types.js";

/**
 * 单轮请求模型，拿到完整回复
 * @remarks 压缩策略不需要工具调用和中间过程，只用非流式请求
 */
const askOnce = async (
	model: Model,
	messages: Message[],
): Promise<{ content: string; usage: Usage }> => {
	const startTime = Date.now();
	const result = await nonStream(model, messages);
	return {
		content: result.content,
		usage: withSpeed(
			result.usage ??
				estimateFallbackUsage(messages, result.content, result.reasoning ?? ""),
			startTime,
		),
	};
};

/** 默认的压缩工具结果策略：让大模型精简消息内容 */
const defaultReplacerOfToolResultContent: Compact.ReplacerOfToolResultContent =
	async (content, options) => {
		const { model } = options ?? {};
		if (!model) {
			return "工具结果已被消费";
		}

		const messages: Message[] = [
			{ role: "user", content },
			{
				role: "user",
				content: "请用一句话简述上面这条消息（直击要点，不要添加任何前言后语）",
			},
		];

		return (await askOnce(model, messages)).content;
	};

/**
 * @returns 实际处理了几条消息
 */
export const compactToolResults = async (
	compressible: Message[],
	options: {
		replacer?: Compact.ReplacerOfToolResultContent;
		mark: string;
		model?: Model;
	},
) => {
	const { replacer, mark, model } = options ?? {};

	// 如果使用默认策略，则必传model，否则无法简化消息内容
	// 如果不使用默认策略，则必传replacer，否则无法进行压缩
	if (!replacer && !model) {
		return 0;
	}
	const _replacer = replacer || defaultReplacerOfToolResultContent;

	let count = 0;
	for (const message of compressible) {
		if (message?.role === "tool" && typeof message.content === "string") {
			// 跳过已经压缩过的消息
			if (message.content.startsWith(mark)) {
				continue;
			}
			const compacted = await _replacer(message.content, { model });
			message.content = mark + compacted;
			count++;
		}
	}

	if (count > 0) {
		logger(`压缩了${count}条工具调用结果`);
	}
	return count;
};

/** 默认的压缩多模态消息策略：让大模型精简消息内容 */
const defaultReplacerOfMediaContent: Compact.ReplacerOfMediaContent = async (
	content,
	options,
) => {
	const { model, modality = "image" } = options ?? {};
	if (!model?.modalities?.includes(modality)) {
		return "媒体资源已被消费";
	}

	const messages: Message[] = [
		{ role: "user", content },
		{
			role: "user",
			content: "请用一句话简述上面这条消息（直击要点，不要添加任何前言后语）",
		},
	];

	return (await askOnce(model, messages)).content;
};

/**
 * @returns 实际处理了几条消息
 */
export const compactMediaMessages = async (
	compressible: Message[],
	options: {
		replacer?: Compact.ReplacerOfMediaContent;
		model?: Model;
	},
) => {
	const { replacer, model } = options ?? {};

	// 如果使用默认策略，则必传model，否则无法简化消息内容
	// 如果不使用默认策略，则必传replacer，否则无法进行压缩
	if (!replacer && !model) {
		return 0;
	}
	const _replacer = replacer || defaultReplacerOfMediaContent;

	let count = 0;
	for (const message of compressible) {
		const mediaModality = isMediaMessage(message);
		if (mediaModality) {
			const compacted = await _replacer(message.content, {
				model,
				modality: mediaModality,
			});
			message.content = createXMLText("media", compacted);
			count++;
		}
	}
	if (count > 0) {
		logger(`压缩了${count}条多模态消息`);
	}
	return count;
};

export const summarizeMessages = async (
	compressible: Message[],
	options: Compact.SummarizeOptions,
) => {
	const { model, systemPrompt, beforeSummarize } = options ?? {};

	// 消息太少不总结
	const summarizable = compressible.slice(1);
	if (summarizable.length === 0) {
		logger("消息太少，无需总结");
		return 0;
	}
	await beforeSummarize?.(summarizable);

	const count = summarizable.length;
	summarizable.push(
		{ role: "system", content: systemPrompt },
		{ role: "user", content: "开始总结上下文" },
	);

	const result = await askOnce(model, summarizable);

	compressible.splice(1, Infinity, {
		role: "user",
		content: createXMLText("summary", result.content),
	});
	logger(`总结了${count}条消息，消耗：`, result.usage);
	return count;
};

/**
 * 最终的兜底压缩策略，从头删除旧消息，直到第二个回调函数返回true（达成目标）
 */
export const discardMessagesUntil = (
	compressible: Message[],
	until: (compressible: Message[]) => boolean,
) => {
	let count = 0;

	while (compressible.length > 0 && !until(compressible)) {
		// 每次删除10%（至少1条）
		let endIndex = Math.max(1, Math.floor(compressible.length / 10));
		// 同样要注意，不能分离tool消息组
		if (compressible[endIndex]?.role === "tool") {
			const range = findToolGroupRange(compressible, endIndex);
			if (range) {
				endIndex = range[1];
			} else {
				// 几乎不可能出现的情况：tool消息往前找不到assistant(tool_calls)
				// 手动找到最后一个tool消息
				while (compressible[endIndex]?.role === "tool") {
					endIndex++;
				}
			}
		}
		count += compressible.splice(0, endIndex).length;
	}

	logger(`丢弃了${count}条旧消息`);
	return count;
};
