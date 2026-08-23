// ================================
// 终端UI
// ================================

import readline from "node:readline";
import type { FinishReason, Usage } from "./types.js";

export class TUI {
	private rl: readline.Interface | null = null;
	private onPromptCB: ((prompt: string) => void) | null = null;
	private busy = false;

	/** 启动TUI */
	start() {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		this.prompt();

		// 停止TUI，清理事件监听
		this.rl.on("close", () => {
			this.rl?.close();
			this.rl = null;
		});
	}

	/** 监听用户输入 */
	private prompt() {
		if (this.busy) {
			return;
		}
		this.rl?.question("> ", (answer) => {
			const input = answer.trim();
			if (input) {
				this.onPromptCB?.(input);
			} else {
				// 如果输入为空，则重新question
				this.prompt();
			}
		});
	}

	/** 用户按下回车触发 */
	onPrompt(cb: (prompt: string) => void) {
		this.onPromptCB = cb;
	}

	// 阻止/允许输入
	setBusy(busy: boolean) {
		this.busy = busy;
		// 恢复输入
		if (!this.busy) {
			this.prompt();
		}
	}

	/** 流式打印AI回复内容（text = reasoning/content） */
	printText(delta: string) {
		process.stdout.write(delta);
	}
	/** 打印工具调用 */
	printToolCall(name: string, args: any) {
		process.stdout.write(`\n[工具调用：${name}] ${args}`);
	}
	/** 打印工具结果 */
	printToolResult(name: string, result: string) {
		process.stdout.write(`\n[工具结果：${name}] ${result}`);
	}
	/** 打印轮次结束原因、token消耗 */
	printFinish(finishReason: FinishReason, usage?: Usage) {
		process.stdout.write(
			`\n[本轮结束：${finishReason}] ${usage ? `输入${usage.prompt_tokens}tok，输出${usage.completion_tokens}tok，总共${usage.total_tokens}tok` : ""}\n\n`,
		);
	}
}
