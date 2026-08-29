import { fetcher } from "@nickyzj2023/utils";
import { defineTool } from "../helper.js";

// 英文星期名映射为中文，让输出直接可读；未知值时回退到原始英文
const weekdayNames: Record<string, string> = {
	Sunday: "星期日",
	Monday: "星期一",
	Tuesday: "星期二",
	Wednesday: "星期三",
	Thursday: "星期四",
	Friday: "星期五",
	Saturday: "星期六",
};

export default defineTool(
	"get_time",
	"查询指定时区的当前时间",
	{
		timezone: {
			type: "string",
			description:
				"完整的IANA时区名称，如Europe/Amsterdam。用户未明确提及时，传入对方语言对应的时区，例如对方使用中文时可传入Asia/Shanghai。",
			required: true,
		},
	},
	async ({ timezone }) => {
		const api = fetcher("https://timeapi.io/api", {
			params: {
				timezone,
			},
		});
		const data = await api.get<any>("/time/current/zone");
		// 时/分/秒统一补零成两位，保证输出时间文本格式一致
		const pad = (n: number) => String(n).padStart(2, "0");
		return [
			`时区：${data.timeZone}${data.dstActive ? "（夏令时已生效）" : ""}`,
			`日期：${data.year}-${pad(data.month)}-${pad(data.day)}（${weekdayNames[data.dayOfWeek] ?? data.dayOfWeek}）`,
			`时间：${pad(data.hour)}:${pad(data.minute)}:${pad(data.seconds)}`,
		].join("\n");
	},
);
