// ================================
// Agent Loop，即Re-Act：用户输入 -> while(模型思考 <-> Agent帮模型调用外部工具) -> 模型输出
// ================================

import { to } from "@nickyzj2023/utils";
import { stream } from "./llm.js";
import type {
	AgentEvent,
	Message,
	Model,
	ToolCall,
	ToolDefinition,
} from "./types.js";

export async function* runAgent(
	model: Model,
	messages: Message[],
	tools: ToolDefinition[],
): AsyncGenerator<AgentEvent> {
	const toolMap = new Map(tools.map((tool) => [tool.function.name, tool]));

	while (true) {
		// 1. 流式调用大模型，收集回复内容
		const content = "";
		const toolCalls: ToolCall[] = [];

		for await (const e of stream(model, messages, tools)) {
			switch (e.type) {
				case "reasoning_delta": {
					yield e;
					break;
				}
				case "content_delta": {
					yield e;
					break;
				}
				case "tool_call": {
					toolCalls.push({
						id: e.id,
						type: "function",
						function: {
							name: e.name,
							arguments: e.args,
						},
					});
					yield e;
					break;
				}
				case "done": {
					yield e;
					break;
				}
			}
		}

		// 2. 把模型的回复推入上下文
		messages.push({
			role: "assistant",
			content: content,
			tool_calls: toolCalls,
		});

		// 3. 如果没有工具调用，则结束循环
		if (toolCalls.length === 0) {
			yield { type: "done", finishReason: "stop" };
			return;
		}

		// 4. 调用工具
		for (const call of toolCalls) {
			const { name, arguments: args } = call.function;
			const tool = toolMap.get(name);

			let result = "";
			if (!tool) {
				result = `不存在工具“${name}”`;
			} else {
				const [error, response] = await to(tool.execute(JSON.parse(args)));
				result = error
					? `工具“${name}”执行出错：${error.message}`
					: String(response);
			}

			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: result,
			});
			yield { type: "tool_result", id: call.id, name: name, result };
		}
	}
}
