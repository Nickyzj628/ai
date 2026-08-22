import type { Model, ToolDefinition } from "./types.js";

/**
 * 辅助定义一个POST /chat/completions支持的model参数
 * @remarks 只有baseUrl字段是必须的
 */
export const defineModel = (config: Model): Model => ({
	modalities: ["text"],
	context: 131072,
	...config,
});

/**
 * 辅助定义一个POST /chat/completions支持的tool对象
 * @param execute 实际执行工具的函数
 */
export const defineTool = (
	name: ToolDefinition["function"]["name"],
	description: ToolDefinition["function"]["description"],
	properties: ToolDefinition["function"]["parameters"]["properties"],
	execute: ToolDefinition["execute"],
): ToolDefinition => {
	// 收集property内部填写的required: true语法糖，推到外面的required数组
	const _required: string[] = [];
	const _properties = Object.entries(properties).reduce(
		(result, [key, property]) => {
			if ("required" in property) {
				_required.push(key);
				delete property.required;
			}
			result[key] = property;
			return result;
		},
		{} as Omit<
			ToolDefinition["function"]["parameters"]["properties"],
			"required"
		>,
	);

	return {
		type: "function",
		function: {
			name,
			description,
			parameters: {
				type: "object",
				properties: _properties,
				required: _required,
			},
		},
		execute,
	};
};
