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
	 * 后续llm.ts发出的请求体会带上它
	 * @example { chat_template_kwargs: { enable_thinking: false } }
	 */
	customBody?: Record<string, any>;
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
					/** 语法糖，等价于在parameters.required.push(当前property key) */
					required?: boolean;
				}
			>;
			required?: string[];
		};
	};
	/** 工具的实际执行函数 */
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
