// ================================
// Agent Loop，即Re-Act：用户输入 -> while(模型思考 <-> Agent帮模型调用外部工具) -> 模型输出
// ================================

import { to } from "@nickyzj2023/utils";
import { nonStream, stream } from "./llm.js";
import type {
	AgentEvent,
	FinishReason,
	Message,
	Model,
	RunAgentOptions,
	ToolCall,
	Usage,
} from "./types.js";
import { estimateFallbackUsage, withSpeed } from "./utils/internalHelper.js";

/**
 * Agent循环
 * @param options.stream 是否流式输出，默认false（每轮推送一个result事件）
 */
export async function* runAgent(
	model: Model,
	messages: Message[],
	options?: RunAgentOptions,
): AsyncGenerator<AgentEvent> {
	const { tools = [], stream: enableStream = false } = options ?? {};
	const toolMap = new Map(tools.map((tool) => [tool.function.name, tool]));

	while (true) {
		// 1. 调用大模型，收集本轮回复内容
		let reasoning = "";
		let content = "";
		const toolCalls: ToolCall[] = [];
		let finishReason: FinishReason = null;
		let usage: Usage | undefined;

		const startTime = Date.now();

		// 流式传输：一边接收llm响应，一边向上转发
		if (enableStream) {
			for await (const e of stream(model, messages, tools)) {
				switch (e.type) {
					case "reasoning_delta": {
						yield e;
						reasoning += e.delta;
						break;
					}
					case "content_delta": {
						yield e;
						content += e.delta;
						break;
					}
					case "tool_call": {
						yield e;
						toolCalls.push({
							id: e.id,
							type: "function",
							function: {
								name: e.name,
								arguments: e.args,
							},
						});
						break;
					}
					case "error": {
						yield e;
						return;
					}
					case "done": {
						finishReason = e.finishReason;
						usage = e.usage;
						// 等后续补齐用量和速度后再推送
						break;
					}
				}
			}
		}
		// 非流式：一次性拿到并转发完整响应
		else {
			const [error, result] = await to(nonStream(model, messages, tools));
			if (error) {
				yield { type: "error", message: error.message };
				return;
			}
			reasoning = result.reasoning ?? "";
			content = result.content;
			toolCalls.push(...result.toolCalls);
			finishReason = result.finishReason;
			usage = result.usage;
		}

		// 2. 结算本轮的用量和速度，推送本轮最终的done事件
		usage = withSpeed(
			usage ?? estimateFallbackUsage(messages, content, reasoning),
			startTime,
		);
		yield { type: "done", content, reasoning, finishReason, usage };

		// 3. 把模型的回复推入上下文
		const message: Message = {
			role: "assistant",
			content,
		};
		if (toolCalls.length > 0) {
			message.tool_calls = toolCalls;
		}
		messages.push(message);

		// 4. 调用工具，为下一轮对话准备工具结果（如果没有就结束循环）
		if (toolCalls.length === 0) {
			return;
		}
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
					: JSON.stringify(response);
			}

			// 推送工具调用结果，然后进入下一轮
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: result,
			});
			yield { type: "tool_result", id: call.id, name: name, result };
		}
	}
}
