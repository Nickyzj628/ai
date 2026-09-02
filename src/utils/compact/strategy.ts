import { createXMLText, logger } from "@nickyzj2023/utils";
import { runAgent } from "../../agent.js";
import type { Message, Model, Usage } from "../../types.js";
import { findToolGroupRange, hasToolCalls } from "./helper.js";
import type { Compact } from "./types.js";

/** 默认的软删除多模态消息策略：让大模型精简消息内容 */
const defaultReplacerOfToolResultContent: Compact.ReplacerOfToolResultContent =
	async (content, options) => {
		const model = options!.model as Model;
		const messages: Message[] = [
			{ role: "user", content },
			{ role: "user", content: "请用一两句话对上条消息做个“省流”" },
		];

		let simplifiedContent = "";
		for await (const e of runAgent(model, messages, [])) {
			if (e.type === "content_delta") {
				simplifiedContent += e.delta;
			}
		}
		return simplifiedContent;
	};

export const softDeleteToolResults = async (
	messages: Message[],
	options: {
		replacer?: Compact.ReplacerOfToolResultContent;
		model?: Model;
	},
) => {
	const { replacer = defaultReplacerOfToolResultContent, model } =
		options ?? {};

	// 如果使用默认策略，则必传model，否则无法简化消息内容
	// 如果不使用默认策略，则必传replacer，否则无法进行压缩
	if (!replacer && !model) {
		return [];
	}

	// 传入的messages是顶层切分后的"可压缩区"（已排除倒数keepCount条），全量处理即可
	// 注意：软删除只替换content不删除消息，不会拆散assistant(tool_calls) + tool配对组
	// 返回被软删的消息引用，供后续hardDeleteSoftMessages按引用识别残留
	const softDeleted: Message[] = [];
	for (const message of messages) {
		if (message?.role === "tool") {
			message.content = await replacer(message.content, { model });
			softDeleted.push(message);
		}
	}

	if (softDeleted.length > 0) {
		logger(`软删除了${softDeleted.length}条工具调用结果消息`);
	}
	return softDeleted;
};

/** 默认的软删除多模态消息策略：让大模型精简消息内容 */
const defaultReplacerOfMediaContent: Compact.ReplacerOfMediaContent = async (
	content,
	options,
) => {
	const model = options!.model as Model;
	const messages: Message[] = [
		{ role: "user", content },
		{ role: "user", content: "请用一两句话描述上方的多模态消息" },
	];

	let simplifiedContent = "";
	for await (const e of runAgent(model, messages, [])) {
		if (e.type === "content_delta") {
			simplifiedContent += e.delta;
		}
	}
	return simplifiedContent;
};

export const softDeleteOldMediaMessages = async (
	messages: Message[],
	options: {
		replacer?: Compact.ReplacerOfMediaContent;
		model?: Model;
	},
) => {
	const { replacer = defaultReplacerOfMediaContent, model } = options ?? {};

	// 如果使用默认策略，则必传model，否则无法简化消息内容
	// 如果不使用默认策略，则必传replacer，否则无法进行压缩
	if (!replacer && !model) {
		return [];
	}

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
			message.content = await replacer(message.content, { model });
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
	// 新规则：除去第一条system消息（系统提示词，保留原样不参与总结），
	// 其余消息都可总结（含后续system消息、<summary>标签消息、多模态消息）
	const summarizableIndices: number[] = [];
	const summarizingMessages: Message[] = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message) {
			continue;
		}

		// 第一条system消息是系统提示词，不参与总结、保留在原始位置
		if (i === 0 && message.role === "system") {
			continue;
		}

		// assistant(tool_calls) + tool配对组需整体总结，避免拆散导致API 400
		// （新规则下组内消息均可总结，整组直接纳入）
		if (hasToolCalls(message)) {
			let j = i + 1;
			while (j < messages.length && messages[j]?.role === "tool") {
				j++;
			}
			const group = messages.slice(i, j);
			for (let k = i; k < j; k++) {
				summarizableIndices.push(k);
			}
			summarizingMessages.push(...group);
			i = j - 1;
			continue;
		}

		// 跳过孤立的tool消息（正常数据流中tool必属于配对组，单独总结会破坏配对导致API 400）
		if (message.role === "tool") {
			continue;
		}

		summarizableIndices.push(i);
		summarizingMessages.push(message);
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
	let usage: Usage | undefined;
	for await (const e of runAgent(model, summarizingMessages, [])) {
		if (e.type === "content_delta") {
			summarized += e.delta;
		} else if (e.type === "done") {
			usage = e.usage;
		}
	}
	logger(`总结了${summarizingMessages.length}条消息，消耗：`, usage);

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
