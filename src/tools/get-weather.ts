import { fetcher, to } from "@nickyzj2023/utils";
import { defineTool } from "../utils/helper.js";

/**
 * 把wttr.in的时间转成好读的"HH:mm"
 * @param rawTime - wttr.in hourly里的time字段，3小时粒度不带冒号，比如"0"、"300"、"1200"
 * @returns 补零后的时间字符串，比如"00:00"、"03:00"、"12:00"
 * @example toHHmm("930") // "09:30"
 */
const toHHmm = (rawTime: any) => {
	// wttr.in只给四位以内的数字串，左边补零到四位刚好能切出小时和分钟
	const padded = String(rawTime ?? "").padStart(4, "0");
	return `${padded.slice(0, 2)}:${padded.slice(2)}`;
};

/**
 * 精简wttr.in返回的天气数据
 * @param rawData - wttr.in API返回的原始JSON
 * @returns 精简后的天气数据
 */
const pickValuableFields = (rawData: any) => {
	if (!rawData) return null;

	// 1. 提取地区信息
	const area = rawData.nearest_area?.[0] || {};
	const location = {
		city: area.areaName?.[0]?.value || "",
		region: area.region?.[0]?.value || "",
		country: area.country?.[0]?.value || "",
		latitude: area.latitude,
		longitude: area.longitude,
	};

	// 2. 提取三天预测里的关键信息
	const weatherForecast = (rawData.weather || []).map((day: any) => ({
		date: day.date,
		maxTempC: day.maxtempC,
		minTempC: day.mintempC,
		astro: {
			sunrise: day.astronomy?.[0]?.sunrise || "",
			sunset: day.astronomy?.[0]?.sunset || "",
			moonPhase: day.astronomy?.[0]?.moon_phase || "",
		},
		hourly: (day.hourly || []).map((h: any) => ({
			time: toHHmm(h.time),
			tempC: h.tempC,
			feelsLikeC: h.FeelsLikeC,
			weatherDesc: h.weatherDesc?.[0]?.value || "",
			chanceOfRain: h.chanceofrain, // 降水概率
			precipMM: h.precipMM, // 降水量 (mm)
			humidity: h.humidity,
			windSpeedKmph: h.windspeedKmph,
			windDir: h.winddir16Point,
		})),
	}));

	return {
		location,
		forecast: weatherForecast,
	};
};

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
		const [error, response] = await to(api.get(`/${city}`));
		if (error) {
			return error.message;
		}
		return pickValuableFields(response);
	},
);
