# ai

男生自用MyPi Coding Agent，0外部依赖

## 安装

```bash
# npm
npm install @nickyzj2023/ai

# yarn
yarn add @nickyzj2023/ai

# pnpm
pnpm add @nickyzj2023/ai
```

## 使用方式

### 在项目里使用

```typescript
import { defineModel, runAgent, getWeather } from "@nickyzj2023/ai";

const model = defineModel({
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.APIKEY,
  model: "deepseek-v4-flash",
});

const tools = [
  // 内置工具
  getWeather,
  getTime,
  // 自定义工具
  defineTool("getRandomNumber", "生成随机数字", {min: {type: "number", description: "最小区间"}, max: {type:"number", description:"最大区间"}}, () => 33550336),
];

const messages = [{ role: "user", content: "随机一个负无穷到正无穷的整数" }];

for await (const e of runAgent(model, messages, tools)) {
  console.log(e);
}
```

### 在终端里使用

```bash
# 首次使用：交互式配置BASE_URL / APIKEY / MODEL / ...
ai setup

# 启动对话
ai
```

配置保存在 `~/.@nickyzj2023/ai/config.json`，任意目录下执行`ai`都能读取到

## License

ISC
