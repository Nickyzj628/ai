export type Model = {
	baseUrl: string;
	/** 如果不传，会尝试使用GET {baseUrl}/models获取到的第一个模型 */
	model?: string;
	/** 使用本地llama.cpp等服务时可以不填 */
	apiKey?: string;
	/**
	 * 后续llm.ts发出的请求体会带上它
	 * @example { chat_template_kwargs: { enable_thinking: false } }
	 */
	customBody?: Record<string, any>;
	/**
	 * 模型支持的消息输入类型
	 * @default ["text"]
	 * @remarks 会在发出请求前检查上下文是否含有不支持的输入
	 */
	modalities?: InputType[];
	/**
	 * 模型的最大上下文
	 * @default 131072
	 * @remarks 会在发出请求后检查上下文是否即将抵达阈值，然后自动压缩
	 */
	context?: number;
};

export type InputType = "text" | "image" | "video" | "audio";

export type Message = {
	role: "system" | "user" | "assistant" | "tool" | "function";
	/** OpenRouter的思考内容字段，其他供应商的会尽可能合并到该字段内 */
	reasoning?: string | null;
	content: string | ContentPart[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	[key: string]: unknown;
};

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

export type ContentPart =
	| TextContent
	| ImageContent
	| AudioContent
	| VideoContent;

export type ToolDefinition = {
	// ================================
	// POST /chat/completions接受的参数
	// ================================
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
					/** 在此处设置的required，发出请求前会自动提到外面去 */
					required?: boolean;
				}
			>;
			required?: string[];
		};
	};

	// ================================
	// 工具的实际执行函数，chatCompletions响应AI的工具调用请求时用到
	// ================================
	handler: (...args: any) => any;
};

export type ToolCall = {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
};
