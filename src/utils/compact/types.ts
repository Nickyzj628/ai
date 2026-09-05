import type { Message, Model, Usage } from "../../types.js";

export namespace Compact {
	export type Options = {
		/** 提供token消耗情况时，能更准确地判断上下文是否达到阈值 */
		usage?: Usage;

		/**
		 * 各种压缩方式统一保留的最近消息条数
		 * @default 10
		 * @remarks 压缩工具调用结果、压缩媒体消息、总结消息、硬删除兜底都会保留最近keepCount条消息不处理
		 */
		keepCount?: number;

		/**
		 * 压缩工具/媒体消息时做个标记，防止下次重复压缩
		 * @default "[已压缩]"
		 */
		compactedMessageMark?: string;

		/**
		 * 上下文>总上下文*ratio时压缩工具调用结果
		 * @default 0.6
		 */
		ratioToCompactToolResults?: number;
		/**
		 * 如何压缩工具调用结果
		 * @default 让其他模型返回简化后的工具结果
		 */
		replacerOfToolResultContent?: Compact.ReplacerOfToolResultContent;

		/**
		 * 上下文>总上下文*ratio时压缩图片/音频/视频消息
		 * @default 0.7
		 */
		ratioToCompactMedia?: number;
		/**
		 * 如何压缩媒体消息
		 * @default 让其他模型用自然语言简短描述一遍
		 */
		replacerOfMediaContent?: Compact.ReplacerOfMediaContent;

		/**
		 * 上下文>总上下文*ratio时总结消息
		 * @default 0.8
		 * @remarks 如果总结成功，会把keepCount以前的消息压成一条用户消息
		 */
		ratioToSummarize?: number;
		/**
		 * 总结消息时的配置项
		 * @default { systemPrompt: "你现在的任务是总结历史消息" }
		 */
		summarizeOptions?: Partial<Compact.SummarizeOptions>;
	};

	export type ReplacerOfToolResultContent = (
		content: Message["content"],
		options?: Record<string, any>,
	) => Promise<string> | string;

	export type ReplacerOfMediaContent = (
		content: Message["content"],
		options?: Record<string, any>,
	) => Promise<string> | string;

	export type SummarizeOptions = {
		/** 指导大模型如何总结消息 */
		systemPrompt: string;
		model: Model;
	};

	export type Result = {
		/** 是否压缩了工具调用结果 */
		hasCompactedToolResults: boolean;
		/** 是否压缩了图片/音频/视频消息 */
		hasCompactedMedia: boolean;
		/** 是否总结了消息 */
		hasSummarized: boolean;
		/** 是否丢弃了一些旧消息（最终兜底策略） */
		hasDiscardMessages: boolean;
	};
}
