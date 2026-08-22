// ================================
// 解析OpenAI API Compatible的SSE事件流
// ================================

import { fetcher, parseSSE, pick, to } from "@nickyzj2023/utils";
import type {
	ChatCompletionsChunk,
	FinishReason,
	Message,
	Model,
	StreamEvent,
	ToolCall,
	ToolDefinition,
	Usage,
} from "./types.js";

/**
 * 分离ToolDefinition中的valid/invalid字段，前者可以传给模型，后者用于本地运算
 * @returns [validObj, invalidObj]
 */
const detachToolArguments = (toolDefinition: ToolDefinition) => {
	return [
		pick(toolDefinition, ["type", "function"]),
		pick(toolDefinition, ["execute"]),
	] as const;
};

/**
 * 从消息中提取模型的思考内容。
 * 不同供应商，即使都用OpenAI API Compatible接口，输出的思考内容字段也可能不同，例如：
 * - OpenRouter里的思考字段为reasoning
 * - 火山引擎的叫reasoning_content
 * @returns 统一返回reasoning作为思考内容字段
 */
const extractReasoning = (msgLike: Record<string, any>) => {
	return String(msgLike.reasoning || msgLike.reasoning_content);
};

export async function* stream(
	model: Model,
	messages: Message[],
	tools: ToolDefinition[] = [],
): AsyncGenerator<StreamEvent> {
	// 剥离ToolDefinition里的私有字段/语法糖
	const validTools = tools.map((tool) => detachToolArguments(tool)[0]);

	const api = fetcher(model.baseUrl, {
		headers: {
			Authorization: `Bearer ${model.apiKey}`,
		},
		// 覆盖默认返回的res.json()，改用野生Response
		parser: async (res) => res,
	});

	// 发出请求
	const [error, response] = await to(
		api.post<Response>("/chat/completions", {
			stream: true,
			model: model.model,
			messages,
			tools: validTools,
		}),
	);
	if (error) {
		yield { type: "error", message: error.message };
		return;
	}

	// 逐行解析SSE事件
	const toolCallBuffers = new Map<number, ToolCall>();
	let usage: Usage | undefined;
	let finishReason: FinishReason = null;
	for await (const chunk of parseSSE<ChatCompletionsChunk>(response)) {
		// 字符串（通常是"[DONE]"），无需处理
		if (typeof chunk === "string") {
			continue;
		}

		if (chunk.usage) {
			usage = chunk.usage;
		}

		// 模型无回复，暂不处理
		const choice = chunk.choices?.[0];
		if (!choice) {
			continue;
		}

		const { delta } = choice;
		const { content: contentDelta, tool_calls: toolCalls } = delta;

		// 模型祈祷中...
		const reasoning = extractReasoning(delta);
		if (reasoning) {
			yield { type: "reasoning_delta", delta: reasoning };
		}

		// 模型确定回复
		if (contentDelta) {
			yield { type: "content_delta", delta: contentDelta.toString() };
		}

		// 拼接工具调用请求
		if (toolCalls) {
			for (const call of toolCalls) {
				const {
					index = 0,
					type = "function",
					id,
					function: fn,
					...extra
				} = call;

				const existing = toolCallBuffers.getOrInsert(index, {
					id: "",
					type,
					function: { name: "", arguments: "" },
				});

				if (id) {
					existing.id = id;
				}
				if (fn?.name) {
					existing.function.name += fn.name;
				}
				if (fn?.arguments) {
					existing.function.arguments += fn.arguments;
				}
				// 一些厂商（Gemini）会在工具调用时要求保留CoT等额外信息
				if (extra) {
					Object.assign(existing, extra);
				}

				toolCallBuffers.set(index, existing);
			}
		}

		if (choice.finish_reason) {
			finishReason = choice.finish_reason;
		}
	}

	// 流式传输结束：
	// 1. 依次发起工具调用
	for (const [, call] of toolCallBuffers) {
		yield {
			type: "tool_call",
			id: call.id,
			name: call.function.name,
			args: call.function.arguments,
		};
	}
	// 2. 发出done事件
	yield { type: "done", finishReason, usage };
}
