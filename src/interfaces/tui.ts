// ================================
// 终端UI
// ================================

import type { Key } from "node:readline";
import readline from "node:readline";
import { compactStr } from "@nickyzj2023/utils";
import { MarkdownRenderer } from "@wterm/markdown";
import type {
	AgentEvent,
	FinishReason,
	ImageContent,
	Usage,
} from "../types.js";
import {
	MAX_CLIPBOARD_IMAGE_BYTES,
	readClipboardImage,
} from "../utils/clipboard.js";
import { humanizeNumber } from "../utils/internalHelper.js";

/** 用户的一次输入：文本 + 通过Ctrl+V粘贴的图片 */
export type UserInput = {
	text: string;
	images: ImageContent[];
};

export class TUI {
	private rl: readline.Interface | null = null;
	private onPrompt: ((input: UserInput) => void | Promise<void>) | null = null;

	/**
	 * 已粘贴、等待随下次请求一起发出的图片
	 * TODO: 改为pendingMedias
	 */
	private pendingImages: ImageContent[] = [];

	/** 剪贴板读取是异步的，回车时要先等它结束，避免漏掉刚粘贴的图片 */
	private clipboardTask: Promise<void> = Promise.resolve();

	/** content专用的markdown渲染器 */
	private md: MarkdownRenderer | null = null;

	/** 是否允许输入 */
	private isBusy = false;

	/** 上次打印内容所属的状态（reasoning/content/tool）
	 * 用于在新的状态开始时改变样式、打印前缀
	 */
	private prevPrintType: AgentEvent["type"] | undefined = undefined;

	/**
	 * 实例化TUI时，接收一个“发出用户提示词”的回调函数
	 * UI只做UI的事，提示词发给谁让调用方决定
	 */
	constructor(onPrompt: (input: UserInput) => void | Promise<void>) {
		this.onPrompt = onPrompt;
	}

	/** 启动TUI */
	start() {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		process.stdin.on("keypress", this.onKeypress);
		this.prompting();

		// 停止TUI后，清理残留的监听事件
		this.rl.on("close", () => {
			process.stdin.off("keypress", this.onKeypress);
			this.rl?.close();
			this.rl = null;
		});
	}

	/** 监听用户的特定按键 */
	private onKeypress = (_str: string, key: Key) => {
		if (this.isBusy) {
			return;
		}
		// 拦截Ctrl+V：读取剪贴板里的图片，随着下次请求一起发出
		// 剪贴板读取是异步的，这里不阻塞readline的按键处理，只排队执行
		if (key?.ctrl && key?.name === "v") {
			this.clipboardTask = this.clipboardTask.then(() => this.attachImage());
		}
	};

	/** 监听用户输入 */
	private prompting() {
		if (this.isBusy) {
			return;
		}

		this.rl?.question("> ", async (answer) => {
			// 等待Ctrl+V触发的剪贴板读取结束，避免刚粘贴的图片被漏掉
			await this.clipboardTask;

			const text = answer.trim();
			const images = this.pendingImages;
			this.pendingImages = [];

			// 没有文本也没有图片，则重新question
			if (!text && images.length === 0) {
				this.prompting();
				return;
			}

			this.isBusy = true;
			await this.onPrompt?.({ text, images });
			this.isBusy = false;

			this.prompting();
		});
	}

	/** 读取剪贴板图片，推入待发送列表 */
	private async attachImage() {
		const image = await readClipboardImage();
		if (!image) {
			this.printNotice("[剪贴板中没有图片]");
			return;
		}
		if (image.bytes > MAX_CLIPBOARD_IMAGE_BYTES) {
			this.printNotice(`[图片过大（${humanizeNumber(image.bytes)}B），已忽略]`);
			return;
		}

		this.pendingImages.push({
			type: "image_url",
			image_url: { url: image.url },
		});
		this.printNotice(`[已粘贴图片：共${this.pendingImages.length}张]`);
	}

	/**
	 * 所有print方法调用前：
	 * 状态切换时打印换行，并记录当前状态
	 * @returns 是否发生了状态切换
	 */
	private preparePrint(type: AgentEvent["type"]): boolean {
		// 状态无变化，跳过
		if (this.prevPrintType === type) {
			return false;
		}
		// 初始化MarkdownRenderer实例
		if (type === "content_delta" && this.md === null) {
			this.md = new MarkdownRenderer();
		}
		// 离开content状态前，确保md(content)已经输出干净
		if (this.prevPrintType === "content_delta") {
			const remaining = this.md?.flush();
			if (remaining) {
				process.stdout.write(remaining);
			}
		}
		process.stdout.write("\n");
		this.prevPrintType = type;
		return true;
	}

	/**
	 * 为文本添加ANSI颜色；非TTY输出（重定向/管道）时返回原文本，避免日志出现转义码。
	 * @param text 原始文本
	 * @param ansiCode ANSI颜色代码，如"90"（亮黑，大多数终端显示为灰色）
	 */
	private colorize(text: string, ansiCode: string): string {
		if (!process.stdout.isTTY) {
			return text;
		}
		return `\x1b[${ansiCode}m${text}\x1b[0m`;
	}

	/** 流式打印AI思考内容（灰色） */
	printReasoning(delta: string) {
		if (this.preparePrint("reasoning_delta")) {
			delta = `[思考内容] ${delta.replaceAll("\n", "")}`;
		}
		process.stdout.write(this.colorize(delta, "90"));
	}

	/** 流式打印AI回复内容 */
	printContent(delta: string) {
		this.preparePrint("content_delta");
		const rendered = this.md?.push(delta);
		if (rendered) {
			process.stdout.write(rendered);
		}
	}

	/** 打印工具调用 */
	printToolCall(name: string, args: any) {
		this.preparePrint("tool_call");
		process.stdout.write(`[工具调用：${name}] ${args}\n`);
	}

	/** 打印工具结果 */
	printToolResult(
		name: string,
		result: string,
		options?: {
			/** 是否省略输出，默认只显示首尾共200字 */
			ellipsis?: boolean;
		},
	) {
		const { ellipsis = true } = options ?? {};
		const _result = ellipsis
			? compactStr(result, { maxLength: 200, truncateMiddle: true })
			: result;

		this.preparePrint("tool_result");
		process.stdout.write(
			this.colorize(`[工具结果：${name}] ${_result}\n`, "90"),
		);
	}

	/** 打印轮次结束原因、token消耗 */
	printFinish(finishReason: FinishReason, usage?: Usage) {
		this.preparePrint("done");
		process.stdout.write(
			this.colorize(
				`[本轮结束：${finishReason}] ${usage ? `输入${humanizeNumber(usage.prompt_tokens)}，输出${humanizeNumber(usage.completion_tokens)}，总共${humanizeNumber(usage.total_tokens)}` : ""}${finishReason === "stop" ? "\n\n" : "\n"}`,
				"90",
			),
		);
	}

	/** 打印一行黄字提示，并重绘当前输入行 */
	printNotice(message: string) {
		process.stdout.write(`${this.colorize(message, "93")}\n`);
		this.rl?.prompt(true);
	}
}
