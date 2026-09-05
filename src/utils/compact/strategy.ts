import { createXMLText, logger } from "@nickyzj2023/utils";
import { runAgent } from "../../agent.js";
import type { Message, Model, Usage } from "../../types.js";
import { isMediaMessage } from "./helper.js";
import type { Compact } from "./types.js";

/** 默认的软删除多模态消息策略：让大模型精简消息内容 */
const defaultReplacerOfToolResultContent: Compact.ReplacerOfToolResultContent =
	async (content, options) => {
		const { model } = options ?? {};
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

export const compactToolResults = async (
	compressible: Message[],
	options: {
		replacer?: Compact.ReplacerOfToolResultContent;
		mark: string;
		model?: Model;
	},
) => {
	const {
		replacer = defaultReplacerOfToolResultContent,
		mark,
		model,
	} = options ?? {};

	// 如果使用默认策略，则必传model，否则无法简化消息内容
	// 如果不使用默认策略，则必传replacer，否则无法进行压缩
	if (!replacer && !model) {
		return [];
	}

	const softDeleted: Message[] = [];
	for (const message of compressible) {
		if (message?.role === "tool" && typeof message.content === "string") {
			// 跳过已经软删除过的消息
			if (message.content.startsWith(mark)) {
				continue;
			}
			message.content = mark;
			message.content += await replacer(message.content, { model });
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
	const { model } = options ?? {};
	const messages: Message[] = [
		{ role: "user", content },
		{ role: "user", content: "请用一两句话简要描述上方的多模态消息" },
	];

	let simplifiedContent = "";
	for await (const e of runAgent(model, messages, [])) {
		if (e.type === "content_delta") {
			simplifiedContent += e.delta;
		}
	}
	return simplifiedContent;
};

export const compactMediaMessages = async (
	compressible: Message[],
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

	let count = 0;
	for (const message of compressible) {
		if (isMediaMessage(message)) {
			message.content = createXMLText(
				"media",
				await replacer(message.content, { model }),
			);
			count++;
		}
	}
	if (count > 0) {
		logger(`压缩了${count}条多模态消息`);
	}
};

export const summarizeMessages = async (
	compressible: Message[],
	options: Compact.SummarizeOptions,
) => {
	const { model, systemPrompt } = options ?? {};

	// 消息太少不总结
	if (compressible.length === 0) {
		logger("消息太少，无需总结");
		return;
	}

	const summarizable = compressible.slice(1);
	summarizable.push(
		{ role: "system", content: systemPrompt },
		{ role: "user", content: "开始总结上下文" },
	);

	let summarized = "";
	let usage: Usage | undefined;
	for await (const e of runAgent(model, summarizable, [])) {
		if (e.type === "content_delta") {
			summarized += e.delta;
		} else if (e.type === "done") {
			usage = e.usage;
		} else if (e.type === "error") {
			throw new Error(e.message);
		}
	}
	logger(`总结了${summarizable.length}条消息，消耗：`, usage);

	compressible.splice(1, Infinity, {
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
