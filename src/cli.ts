import { loadEnvFile } from "node:process";
import { runAgent } from "./agent.js";
import { defineModel } from "./helper.js";
import getWeather from "./tools/get-weather.js";
import { TUI } from "./tui.js";
import type { Message } from "./types.js";

loadEnvFile(".env");

// 1. 读取配置
const model = defineModel({
	baseUrl: "https://api.deepseek.com/v1",
	apiKey: process.env.APIKEY,
	model: "deepseek-v4-flash",
});

// 2. 读取上下文
const messages: Message[] = [];

// 3. 读取工具
const tools = [getWeather];

// 4. 启动TUI，监听用户输入，按下回车后调用Agent
const tui = new TUI(async (input) => {
	messages.push({ role: "user", content: input });

	for await (const e of runAgent(model, messages, tools)) {
		switch (e.type) {
			case "reasoning_delta": {
				tui.printReasoning(e.delta);
				break;
			}
			case "content_delta": {
				tui.printContent(e.delta);
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
				tui.printFinish(e.finishReason, e.usage);
				break;
			}
		}
	}
});
tui.start();
