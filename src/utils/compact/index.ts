import { logger, to } from "@nickyzj2023/utils";
import type { Message, Model, Usage } from "../../types.js";
import { estimateTokens } from "../helper.js";
import { findToolGroupRange } from "./helper.js";
import {
	hardDeleteOldMessages,
	hardDeleteSoftMessages,
	softDeleteOldMediaMessages,
	softDeleteToolResults,
	summarizeMessages,
} from "./strategy.js";
import type { Compact } from "./types.js";

/** 各种压缩策略，会跟随compact函数暴露出去，方便单独使用 */
const compactMethods = {
	summarizeMessages,
	softDeleteToolResults,
	softDeleteOldMediaMessages,
	hardDeleteSoftMessages,
	hardDeleteOldMessages,
};

/**
 * 自动优化上下文，类似AI Coding Agent的/compact命令
 */
export const compact = Object.assign(
	async (
		messages: Message[],
		model: Model,
		options?: {
			/** 提供token消耗情况时，能更准确地判断上下文是否达到阈值 */
			usage?: Usage;

			/**
			 * 各种压缩方式统一保留的最近消息条数
			 * @default 10
			 * @remarks 压缩工具调用结果、压缩媒体消息、总结消息、硬删除兜底都会保留最近keepCount条消息不处理
			 */
			keepCount?: number;

			/**
			 * 上下文>总上下文*ratio时压缩工具调用结果
			 * @default 0.5
			 */
			ratioToCompactToolResult?: number;
			/**
			 * 如何压缩工具调用结果，例如让其他模型返回精简后的工具结果
			 * @default (content) => "（已被消费）"
			 */
			replacerOfToolResultContent?: Compact.ReplacerOfToolResultContent;

			/**
			 * 上下文>总上下文*ratio时压缩图片/音频/视频消息
			 * @default 0.6
			 */
			ratioToCompactMedia?: number;
			/**
			 * 如何压缩媒体消息，例如让其他模型用自然语言简短描述一遍
			 * @default (content) => "（已被丢弃）"
			 */
			replacerOfMediaContent?: Compact.ReplacerOfMediaContent;

			/**
			 * 用于标记哪些消息被软删除了
			 */
			softDeletedMessageMark?: string;
			/**
			 * 上下文>总上下文*ratio时清理软删除残留的占位消息
			 * @default 0.7
			 * @remarks
			 * 软删除（ratioToCompactToolResult/ratioToCompactMedia）只替换content不删消息，
			 * 该选项负责把残留的占位消息真正移除。信息在软删除时已丢失，清理不损失任何额外信息。
			 * 阈值应介于ratioToCompactMedia与ratioToSummarize之间：
			 * 太早则媒体软删还没执行、无残留可清；太晚则总结/硬删除兜底已处理整个压缩区，清理失去意义
			 */
			ratioToClearSoftDeletedMessages?: number;

			/**
			 * 上下文>总上下文*ratio时总结消息
			 * @default 0.8
			 * @remarks 如果总结成功，会把keepCount(默认10，见顶层选项)以前的消息压成一条消息；如果总结失败，会采取兜底压缩方法：硬删除keepCount以前的消息
			 */
			ratioToSummarize?: number;
			/**
			 * 总结消息时的配置项
			 * @default { model: undefined, systemPrompt: "总结历史消息" }
			 */
			summarizeOptions?: Partial<Compact.SummarizeOptions>;
		},
	): Promise<Compact.CompactResult> => {
		const {
			usage,

			keepCount = 10,

			ratioToCompactToolResult = 0.5,
			replacerOfToolResultContent,

			ratioToCompactMedia = 0.6,
			replacerOfMediaContent,

			ratioToClearSoftDeletedMessages = 0.7,
			softDeletedMessageMark = "[已简化]",

			ratioToSummarize = 0.8,
			summarizeOptions,
		} = options ?? {};
		const context = model?.context ?? 131072;
		const tokens = usage?.total_tokens ?? estimateTokens(messages);

		const result: Compact.CompactResult = {
			hasCompactedToolResult: false,
			hasCompactedMedia: false,
			hasClearedSoftDeletedMessages: false,
			hasSummarized: false,
			hasDeletedOldMessages: false,
		};

		// 顶层只做一次keepCount切分，内部各压缩方式只处理"可压缩区"，无需各自关心keepCount：
		// - compressible：前段可压缩区，所有压缩方式只作用于这部分
		// - reserved：倒数keepCount条保留区，原样保留
		// 切点需对齐到配对组边界，避免拆散assistant(tool_calls) + tool配对组
		let endIndex = Math.max(0, messages.length - keepCount);

		// 切点处第一条保留消息是tool时，其配对组头(assistant(tool_calls))在被切掉的一侧，
		// 继续切分会拆散配对组导致API 400：把整组推入可压缩区，保留区从组尾开始
		// （组尾由findToolGroupRange统一计算，与hardDeleteSoftMessages共用配对组约定）
		if (messages[endIndex]?.role === "tool") {
			const range = findToolGroupRange(messages, endIndex);
			if (range) {
				endIndex = range[1];
			} else {
				// 防御性兜底：tool消息理论上必有配对组头（数据异常时才会走到）。
				// 与findToolGroupRange的组内约定一致：跳过连续tool，避免保留区出现无法配对的tool消息
				while (messages[endIndex]?.role === "tool") {
					endIndex++;
				}
			}
		}
		const compressible = messages.slice(0, endIndex);
		const reserved = messages.slice(endIndex);

		// 收集本轮所有被软删的消息引用，供清理阶段按引用识别残留
		const softDeleted = new Set<Message>();

		// 上下文 > 总上下文*50% => 压缩工具调用结果
		if (tokens > context * ratioToCompactToolResult) {
			const softDeletedMessages = await softDeleteToolResults(compressible, {
				replacer: replacerOfToolResultContent,
				mark: softDeletedMessageMark,
				model,
			});
			for (const message of softDeletedMessages) {
				softDeleted.add(message);
			}
			result.hasCompactedToolResult = true;
		}

		// 上下文 > 总上下文*60% => 压缩图片/音频/视频消息
		if (tokens > context * ratioToCompactMedia) {
			const softDeletedMessages = await softDeleteOldMediaMessages(
				compressible,
				{
					replacer: replacerOfMediaContent,
					mark: softDeletedMessageMark,
					model,
				},
			);
			for (const message of softDeletedMessages) {
				softDeleted.add(message);
			}
			result.hasCompactedMedia = true;
		}

		// 上下文 > 总上下文*70% => 清理软删除残留的占位消息
		// （清理会改变压缩区长度，需重组回原数组；信息已在软删除时丢失，此处不损失任何额外信息）
		if (tokens > context * ratioToClearSoftDeletedMessages) {
			hardDeleteSoftMessages(compressible, softDeleted);
			result.hasClearedSoftDeletedMessages = true;
			messages.splice(0, messages.length, ...compressible, ...reserved);
		}

		// 上下文 > 总上下文*80% => 总结消息
		if (tokens > context * ratioToSummarize) {
			const { systemPrompt = "你现在的任务是总结历史消息" } =
				summarizeOptions ?? {};

			const [error] = await to(
				summarizeMessages(compressible, { model, systemPrompt }),
			);
			result.hasSummarized = true;
			if (error) {
				// 总结失败，作为兜底硬删除压缩区较早的消息
				logger(`总结失败（${error.message}），改用硬删除兜底`);
				hardDeleteOldMessages(compressible);
				result.hasDeletedOldMessages = true;
			}

			// 总结/硬删除会改变压缩区的长度，需把处理后的压缩区+保留区合并回原数组
			// （软删除只改content，对象引用共享，无需重组）
			messages.splice(0, messages.length, ...compressible, ...reserved);
		}

		return result;
	},
	compactMethods,
);
