import { fetcher } from "@nickyzj2023/utils";
import { defineTool } from "../helper.js";

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
		const data = await api.get<any>(`/${city}`);
		const currentCondition = data.current_condition[0];
		return [
			`城市: ${city}`,
			`当前温度: ${currentCondition.temp_C}°C`,
			`体感温度: ${currentCondition.FeelsLikeC}°C`,
			`天气状况: ${currentCondition.weatherDesc[0].value}`,
			`湿度: ${currentCondition.humidity}%`,
		].join("\n");
	},
);
