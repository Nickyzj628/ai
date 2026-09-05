import { fetcher } from "@nickyzj2023/utils";
import { defineTool } from "../utils/helper.js";

export default defineTool(
	"get_weather",
	"查询指定城市的天气情况",
	{
		city: {
			type: "string",
			description: "城市名，如shanghai、tokyo",
			required: true,
		},
	},
	async ({ city }) => {
		const api = fetcher("https://wttr.in", {
			params: {
				format: "j1", // 返回JSON格式
			},
		});
		return api.get(`/${city}`);
	},
);
