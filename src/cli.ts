// ================================
// CLI入口：ai [setup | --help | 一段提示词]，带提示词时直接开聊
// ================================

import {
	type ContentPart,
	defineModel,
	getTime,
	getWeather,
	type ImageContent,
	type Message,
	runAgent,
	type ToolDefinition,
} from "./index.js";
import { runSetup } from "./interfaces/setup.js";
import { TUI } from "./interfaces/tui.js";
import { loadMCPTools } from "./tools/mcp.js";
import { loadConfig } from "./utils/config.js";

/**
 * 组装用户消息的content
 * @remarks 有图片时必须用ContentPart[]（OpenAI多模态协议），纯文本则保持字符串
 */
const buildUserContent = (
	text: string,
	images: ImageContent[],
): string | ContentPart[] => {
	if (images.length === 0) {
		return text;
	}

	const content: ContentPart[] = [];
	if (text) {
		content.push({ type: "text", text });
	}
	content.push(...images);
	return content;
};

/**
 * 启动交互对话：配置来自全局配置文件，环境变量可临时覆盖
 * @param prompt 带上提示词时，先自动发出这一轮，之后照常继续对话
 */
const startChat = async (prompt?: string) => {
	// 1. 读取配置
	const config = loadConfig();
	if (!config) {
		console.error("请先运行 `ai setup` 配置一个模型");
		process.exit(1);
	}

	// 2. 组装模型配置
	const model = defineModel(config);

	// 3. 后台加载MCP工具：不await，先启动TUI让用户自由输入，首个请求发出前才等待加载完成
	let mcpReady = false;
	const mcpLoading = loadMCPTools(config.mcpServers).then((tools) => {
		mcpReady = true;
		return tools;
	});

	// 4. 组装上下文
	const messages: Message[] = [
		{
			role: "system",
			content: `你是${model.model}，当前时间${new Date().toLocaleString()}`,
		},
	];

	// 5. 工具列表在会话中保持不变，首次请求时组装一次后复用
	let tools: ToolDefinition[] | null = null;

	// 6. 启动TUI，监听用户输入，按下回车后调用Agent
	const tui = new TUI(async ({ text, images }) => {
		messages.push({
			role: "user",
			content: buildUserContent(text, images),
		});

		// 7. 发出请求前等待MCP加载完成
		if (!mcpReady) {
			tui.printNotice("MCP工具还未加载完成，请稍候……");
		}
		tools ??= [getWeather, getTime, ...(await mcpLoading)];

		for await (const e of runAgent(model, messages, tools)) {
			tui.render(e);
		}
	});
	tui.start(prompt);
};

/** 打印命令用法 */
const printHelp = () => {
	console.log(`用法: ai [命令/提示词]

	命令:
  --help    显示帮助
  setup     交互式配置模型APIKEY / BASE_URL / MODEL（保存到 ~/.@nickyzj2023/ai/config.json）

带上提示词时，启动对话的同时先把这段提示词发出去（如\`ai 明天适合洗车吗\`）
不带参数则直接进入对话`);
};

// 命令行参数（已去掉node和脚本路径）：多词提示词会被shell拆成多个参数，这里再拼回一句
const args = process.argv.slice(2);
const command = args[0];

// CLI路由，根据命令启动特定interface
switch (command) {
	case undefined: {
		startChat();
		break;
	}
	case "setup": {
		await runSetup();
		break;
	}
	case "--help":
	case "-h": {
		printHelp();
		break;
	}
	default: {
		// 以-开头的还是按命令处理，免得把ai --foo当成提示词发出去
		if (command.startsWith("-")) {
			console.error(`未知命令：${command}（可以运行ai --help查看用法）`);
			process.exit(1);
		}
		// 多词提示词会被shell拆成多个参数，拼回一句；拼不出来（比如ai ""）就当普通的ai用
		startChat(args.join(" ").trim() || undefined);
	}
}
