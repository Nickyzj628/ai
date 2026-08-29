#!/usr/bin/env node

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { runAgent } from "./agent.js";
import { defineModel } from "./helper.js";
import getWeather from "./tools/get-weather.js";
import { TUI } from "./tui.js";
import type { Message } from "./types.js";

// 仅在存在.env时加载：发布后用户可能没有该文件，直接调用会抛错
if (existsSync(".env")) {
	loadEnvFile(".env");
}

// 1. 读取配置（环境变量可覆盖默认的DeepSeek地址与模型）
const model = defineModel({
	baseUrl: process.env.BASE_URL ?? "https://api.deepseek.com/v1",
	apiKey: process.env.APIKEY,
	model: process.env.MODEL ?? "deepseek-v4-flash",
});

if (!model.apiKey) {
	console.error("请先在环境变量或.env文件中填入APIKEY（目前仅支持DeepSeek）");
	process.exit(1);
}

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
