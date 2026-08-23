import { runAgent } from "./agent.js";
import { defineModel } from "./helper.js";
import getWeather from "./tools/get-weather.js";
import { TUI } from "./tui.js";
import type { AgentEvent, Message } from "./types.js";

// 1. 读取配置
const model = defineModel({
	baseUrl: "https://nickyzj.run:11434/v1",
	model: "MiniCPM5-1B-Q4_K_M",
});

// 2. 读取上下文
const messages: Message[] = [
	{
		role: "system",
		content: `你是${model.model}，运行在@nickyzj2023/ai项目内置的CLI环境中，正被用于调试该项目，确认无BUG后将会对外发布项目`,
	},
];

// 3. 读取工具
const tools = [getWeather];

// 4. 启动TUI，监听用户输入，按下回车后调用Agent
const tui = new TUI();
tui.onPrompt(async (input) => {
	tui.setBusy(true);
	messages.push({ role: "user", content: input });

	let prevEventType: AgentEvent["type"] = "done";
	for await (const e of runAgent(model, messages, tools)) {
		switch (e.type) {
			case "reasoning_delta": {
				if (prevEventType !== "reasoning_delta") {
					tui.printText("[思考内容] ");
				}
				tui.printText(e.delta);
				break;
			}
			case "content_delta": {
				if (prevEventType !== "content_delta" && prevEventType !== "done") {
					tui.printText("\n< ");
				}
				tui.printText(e.delta);
				break;
			}
			case "tool_call": {
				tui.printToolCall(e.name, e.args);
				break;
			}
			case "tool_result": {
				tui.printToolResult(e.name, e.result);
				break;
			}
			case "done": {
				// 去重
				if (prevEventType === "done") {
					break;
				}
				tui.printFinish(e.finishReason, e.usage);
				break;
			}
		}
		prevEventType = e.type;
	}

	tui.setBusy(false);
});
tui.start();
