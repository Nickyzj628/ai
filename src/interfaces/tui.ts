// ================================
// 终端UI
// ================================

import readline from "node:readline";
import type { AgentEvent, FinishReason, Usage } from "../types.js";

export class TUI {
	private rl: readline.Interface | null = null;
	private onPrompt: ((prompt: string) => void | Promise<void>) | null = null;

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
	constructor(onPrompt: (prompt: string) => void | Promise<void>) {
		this.onPrompt = onPrompt;
	}

	/** 启动TUI */
	start() {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		this.prompting();

		// 停止TUI后，清理残留的监听事件
		this.rl.on("close", () => {
			this.rl?.close();
			this.rl = null;
		});
	}

	/** 监听用户输入 */
	private prompting() {
		if (this.isBusy) {
			return;
		}

		this.rl?.question("> ", async (answer) => {
			const input = answer.trim();
			// 如果输入为空，则重新question
			if (!input) {
				this.prompting();
				return;
			}

			this.isBusy = true;
			await this.onPrompt?.(input);
			this.isBusy = false;

			this.prompting();
		});
	}

	/**
	 * 所有print方法调用前的统一入口（相当于“父类逻辑”）：
	 * 状态切换时打印换行，并记录当前状态。
	 * @returns 是否发生了状态切换
	 */
	private preparePrint(type: AgentEvent["type"]): boolean {
		if (this.prevPrintType === type) {
			return false;
		}
		process.stdout.write("\n");
		this.prevPrintType = type;
		return true;
	}

	/**
	 * 为文本添加ANSI颜色；非TTY输出（重定向/管道）时返回原文本，避免日志出现转义码。
	 * @param text 原始文本
	 * @param ansiCode ANSI颜色代码，如 "90"（亮黑，大多数终端显示为灰色）
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
		process.stdout.write(delta);
	}

	/** 打印工具调用 */
	printToolCall(name: string, args: any) {
		this.preparePrint("tool_call");
		process.stdout.write(`[工具调用：${name}] ${args}`);
	}

	/** 打印工具结果 */
	printToolResult(name: string, result: string) {
		this.preparePrint("tool_result");
		process.stdout.write(this.colorize(`[工具结果：${name}] ${result}`, "90"));
	}

	/** 打印轮次结束原因、token消耗 */
	printFinish(finishReason: FinishReason, usage?: Usage) {
		this.preparePrint("done");
		process.stdout.write(
			this.colorize(
				`[本轮结束：${finishReason}] ${usage ? `输入${usage.prompt_tokens}tok，输出${usage.completion_tokens}tok，总共${usage.total_tokens}tok` : ""}${finishReason === "stop" ? "\n\n" : "\n"}`,
				"90",
			),
		);
	}
}
