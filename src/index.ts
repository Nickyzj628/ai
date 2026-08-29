// ================================
// 库入口：统一导出Agent循环、流式LLM接口、辅助工具
// ================================

export { runAgent } from "./agent.js";
export { defineModel, defineTool } from "./helper.js";
export { stream } from "./llm.js";

// 内置示例工具（源文件为default导出，这里转成命名导出）
export { default as getWeather } from "./tools/get-weather.js";

// 终端UI（Node专用）
export { TUI } from "./tui.js";

// 全部公共类型
export type * from "./types.js";
