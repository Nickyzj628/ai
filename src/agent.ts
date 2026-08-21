// ================================
// Agent Loop：用户输入 -> while(agent提供模型所需信息) -> 模型输出
// ================================

import { to } from "@nickyzj2023/utils";
import type { Message, Model, ToolCall, ToolDefinition } from "./types";

export async function* runAgent(
	model: Model,
	messages: Message[],
	tools: ToolDefinition[],
) {
	const toolMap = new Map(tools.map((tool) => [tool.function.name, tool]));
	const stopReason: "end_turn" | "tool_use" | "max_tokens" | "aborted" =
		"end_turn";

	while (true) {
		// 1. 流式调用大模型，收集回复内容
		const text = "";
		const toolCalls: ToolCall[] = [];

		for await (const e of stream(model, messages, tools)) {
			console.log(e);
		}

		// 2. 把模型的回复推入上下文
		messages.push({
			role: "assistant",
			content: text,
			tool_calls: toolCalls,
		});

		// 3. 如果没有工具调用，则结束循环
		if (toolCalls.length === 0) {
			yield { type: "turn_end", stopReason };
			return;
		}

		// 4. 调用工具
		const toolResults: any[] = [];
		for (const call of toolCalls) {
			const { name, arguments: args } = call.function;
			const tool = toolMap.get(name);
			console.log(call, tool);

			let result = "";
			if (!tool) {
				result = `不存在工具“${name}”`;
			} else {
				const [error, response] = await to(tool.execute(args));
				result = error
					? `工具“${name}”执行出错：${error.message}`
					: String(response);
			}

			toolResults.push({ tool_call_id: call.id, content: result });
			yield { type: "tool_result", id: call.id, name: name, result };
		}

		// 5. 把工具结果推入上下文，继续循环
		messages.push(
			...toolResults.map((result) => ({ role: "tool", ...result })),
		);
	}
}
