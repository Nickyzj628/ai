import { logger, to } from "@nickyzj2023/utils";
import type { Message, Model } from "../../types.js";
import { estimateTokens } from "../helper.js";
import { findToolGroupRange } from "./helper.js";
import {
	compactMediaMessages,
	compactToolResults,
	hardDeleteOldMessages,
	summarizeMessages,
} from "./strategy.js";
import type { Compact } from "./types.js";

/** 各种压缩策略，会跟随compact函数暴露出去，方便单独使用 */
const compactMethods = {
	compactToolResults,
	compactMediaMessages,
	summarizeMessages,
	hardDeleteOldMessages,
};

/**
 * 自动优化上下文，类似AI Coding Agent的/compact命令
 */
export const compact = Object.assign(
	async (
		messages: Message[],
		model: Model,
		options?: Compact.Options,
	): Promise<Compact.Result> => {
		const {
			usage,
			keepCount = 10,

			compactedMessageMark = "[已简化]",
			ratioToCompactToolResults = 0.6,
			replacerOfToolResultContent,
			ratioToCompactMedia = 0.7,
			replacerOfMediaContent,

			ratioToSummarize = 0.8,
			summarizeOptions,
		} = options ?? {};

		const context = model?.context ?? 131072;
		const tokens = usage?.total_tokens ?? estimateTokens(messages);

		const result: Compact.Result = {
			hasCompactedToolResults: false,
			hasCompactedMedia: false,
			hasSummarized: false,
			hasDeletedOldMessages: false,
		};

		// 根据keepCount切割上下文：
		// - compressible：可压缩区
		// - reserved：系统提示词、倒数keepCount条保留区
		const startIndex = 1;
		let endIndex = Math.max(startIndex, messages.length - keepCount);

		// 另外还需注意，不能把assistant(tool_calls)和tool消息分离
		if (messages[endIndex]?.role === "tool") {
			const range = findToolGroupRange(messages, endIndex);
			if (range) {
				endIndex = range[1];
			} else {
				// 几乎不可能出现的情况：tool消息往前找不到assistant(tool_calls)
				// 手动找到最后一个tool消息
				while (messages[endIndex]?.role === "tool") {
					endIndex++;
				}
			}
		}
		endIndex = Math.max(startIndex, messages.length - keepCount);

		// 安全切割
		const reservedStart = messages.slice(0, startIndex);
		const compressible = messages.slice(startIndex, endIndex);
		const reservedEnd = messages.slice(endIndex);

		// 上下文 > 总上下文*60% => 压缩工具调用结果
		if (tokens > context * ratioToCompactToolResults) {
			await compactToolResults(compressible, {
				replacer: replacerOfToolResultContent,
				mark: compactedMessageMark,
				model,
			});
			result.hasCompactedToolResults = true;
		}

		// 上下文 > 总上下文*70% => 压缩图片/音频/视频消息
		if (tokens > context * ratioToCompactMedia) {
			await compactMediaMessages(compressible, {
				replacer: replacerOfMediaContent,
				model,
			});
			result.hasCompactedMedia = true;
		}

		// 上下文 > 总上下文*80% => 总结消息
		if (tokens > context * ratioToSummarize) {
			const { systemPrompt = "你现在的任务是总结历史消息" } =
				summarizeOptions ?? {};

			const [error] = await to(
				summarizeMessages(compressible, { model, systemPrompt }),
			);
			if (!error) {
				result.hasSummarized = true;
			} else {
				// 总结失败，作为兜底硬删除压缩区较早的消息
				logger(`总结失败（${error.message}），改用硬删除兜底`);
				hardDeleteOldMessages(compressible);
				result.hasDeletedOldMessages = true;
			}

			// 总结/硬删除会改变compressible，需要更新原数组
			messages.splice(
				0,
				Infinity,
				...reservedStart,
				...compressible,
				...reservedEnd,
			);
		}

		return result;
	},
	compactMethods,
);
