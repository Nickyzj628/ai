// ================================
// 模型配置
// ================================

export type Model = {
	baseUrl: string;
	/** 如果不传，会尝试使用GET {baseUrl}/models获取到的第一个模型 */
	model?: string;
	/** 使用本地llama.cpp等服务时可以不填 */
	apiKey?: string;
	/**
	 * 模型支持的消息输入类型
	 * @default ["text"]
	 * @remarks 会在每轮对话前校验消息类型，存在不支持的输入时报错
	 */
	modalities?: Modality[];
	/**
	 * 模型的最大上下文
	 * @default 131072
	 * @remarks 会在每轮对话结束后检查上下文阈值，自动压缩消息
	 */
	context?: number;
	/**
	 * 自定义请求体，会在每轮请求时带上
	 * @example chat_template_kwargs: { enable_thinking: false }
	 */
	[key: string]: unknown;
};

/** 文/图/音/视频，暂未实现文件输入 */
export type Modality = "text" | "image" | "audio" | "video";

// ================================
// 消息类型
// ================================

export type Message = {
	role: "system" | "user" | "assistant" | "tool";
	reasoning?: string | null;
	content: string | ContentPart[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	[key: string]: unknown;
};

export type ContentPart =
	| TextContent
	| ImageContent
	| AudioContent
	| VideoContent;

export type TextContent = {
	type: "text";
	text: string;
};

export type ImageContent = {
	type: "image_url";
	image_url: {
		url: string;
	};
};

export type AudioContent = {
	type: "input_audio";
	input_audio: {
		/** 使用公网可访问的音频链接 */
		url?: string;
		/** 使用base64 */
		data?: string;
		format: string;
	};
};

export type VideoContent = {
	type: "video_url";
	video_url: {
		url: string;
	};
};

// ================================
// 工具定义、调用
// ================================

export type ToolDefinition = {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<
				string,
				{
					type: string;
					description?: string;
					/** defineTool()提供的语法糖，等价于在parameters.required.push(当前property key) */
					required?: boolean;
				}
			>;
			required?: string[];
		};
	};
	/** 工具的实际执行函数 */
	execute: (...args: any) => any;
};

export type ToolCall = {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
};

// ================================
// llm.ts SSE事件流
// ================================

/** stream()对外输出的事件 */
export type LLMEvent =
	| { type: "reasoning_delta"; delta: string }
	| { type: "content_delta"; delta: string }
	| { type: "tool_call"; id: string; name: string; args: any }
	| { type: "done"; finishReason: string | null; usage?: Usage }
	| { type: "error"; message: string };

/** stream()内部要处理的事件流 */
export type ChatCompletionsChunk =
	| {
			id: string;
			object: "chat.completion.chunk";
			created: number;
			model: string;
			choices: {
				index: number;
				delta: Pick<Message, "reasoning" | "content"> & {
					tool_calls?: ({ index: number } & Partial<ToolCall>)[];
				};
				finish_reason: FinishReason;
			}[];
			usage?: Usage;
	  }
	| "[DONE]";

/** 模型可能返回的finish_reason值：停止/工具调用/上下文超限 */
export type FinishReason = "stop" | "tool_calls" | "length" | null;

export type Usage = {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	[key: string]: any;
};

// ================================
// agent.ts
// ================================

export type AgentEvent =
	| { type: "assistant_text"; delta: string }
	| { type: "tool_call"; id: string; name: string; args: unknown }
	| { type: "tool_result"; id: string; name: string; result: string }
	| {
			type: "turn_end";
			stopReason: "end_turn" | "max_tokens" | "aborted" | "error";
	  };
