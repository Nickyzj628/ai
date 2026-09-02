import type { Message, Model } from "../../types.js";

export namespace Compact {
	export type ReplacerOfToolResultContent = (
		content: Message["content"],
		options?: Record<string, any>,
	) => Promise<Message["content"]> | Message["content"];

	export type ReplacerOfMediaContent = (
		content: Message["content"],
		options?: Record<string, any>,
	) => Promise<Message["content"]> | Message["content"];

	export type SummarizeOptions = {
		/** 用什么模型总结 */
		model: Model;
		/** 用于指导大模型如何总结消息的提示词 */
		systemPrompt: string;
	};

	/**
	 * compactMessages 的返回值，告知调用方各压缩动作是否执行
	 * @remarks
	 * 这些字段是"操作级"标志：为 true 只代表对应操作已执行，不代表一定产生了效果。
	 * 例如 hasSummarized 为 true 只代表进入了总结流程，是否真的总结成功，
	 * 应由调用方检查消息数组里是否出现含 `<summary>` 标签的消息来判断。
	 */
	export type CompactResult = {
		/** 是否执行了压缩工具调用结果 */
		hasCompactedToolResult: boolean;
		/** 是否执行了压缩图片/音频/视频消息 */
		hasCompactedMedia: boolean;
		/** 是否执行了清理软删除残留的占位消息 */
		hasClearedSoftDeletedMessages: boolean;
		/** 是否执行了总结消息操作（是否真的总结，请检查消息中是否出现`<summary>`标签） */
		hasSummarized: boolean;
		/** 是否执行了兜底硬删除较早消息 */
		hasDeletedOldMessages: boolean;
	};
}
