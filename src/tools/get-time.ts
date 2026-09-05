import { fetcher } from "@nickyzj2023/utils";
import { defineTool } from "../utils/helper.js";

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
		return api.get("/time/current/zone");
	},
);
