// ================================
// 读取系统剪贴板里的图片（供TUI的Ctrl+V粘贴使用）
// ================================

import { execFile } from "node:child_process";

/** 剪贴板图片的原始字节上限：超过则拒绝，避免把超大图片塞入请求体 */
export const MAX_CLIPBOARD_IMAGE_BYTES = 5 * 1024 * 1024;

export type ClipboardImage = {
	/** data URL，可直接用作ImageContent的image_url.url */
	url: string;
	/** 原始图片字节数 */
	bytes: number;
};

/**
 * 执行命令并原样取回stdout（二进制安全）
 * @param maxBuffer 允许的最大输出字节数
 */
const run = (command: string, args: string[], maxBuffer: number) => {
	return new Promise<Buffer>((resolve, reject) => {
		execFile(
			command,
			args,
			{ encoding: "buffer", timeout: 5000, maxBuffer },
			(error, stdout) => {
				if (error) {
					reject(error);
				} else {
					resolve(stdout);
				}
			},
		);
	});
};

/** 一个候选读取方式：可执行文件 + 参数 */
type ClipboardCommand = {
	command: string;
	args: string[];
	/** stdout是base64文本（而非原始图片字节） */
	base64?: boolean;
};

/** 组装成OpenAI接口能接受的data URL */
const toDataUrl = (buffer: Buffer, mime = "image/png"): ClipboardImage => ({
	url: `data:${mime};base64,${buffer.toString("base64")}`,
	bytes: buffer.length,
});

/** Windows：用PowerShell把剪贴板里的图片转成base64后读出 */
const readWindows = async (): Promise<ClipboardImage | null> => {
	const script = [
		"Add-Type -AssemblyName System.Windows.Forms",
		"Add-Type -AssemblyName System.Drawing",
		"$img = [System.Windows.Forms.Clipboard]::GetImage()",
		"if ($img) {",
		"$ms = New-Object System.IO.MemoryStream",
		"$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
		"[Convert]::ToBase64String($ms.ToArray())",
		"}",
	].join("; ");
	const stdout = await run(
		"powershell.exe",
		["-NoProfile", "-Command", script],
		64 * 1024 * 1024,
	);
	const base64 = stdout.toString("utf8").trim();
	return base64 ? toDataUrl(Buffer.from(base64, "base64")) : null;
};

/** Linux：Wayland优先，其次X11，最后用python3的tkinter兜底；命令未安装或剪贴板里不是图片时跳过 */
const readLinux = async (): Promise<ClipboardImage | null> => {
	const candidates: ClipboardCommand[] = [
		{ command: "wl-paste", args: ["--no-newline", "--type", "image/png"] },
		{
			command: "xclip",
			args: ["-selection", "clipboard", "-t", "image/png", "-o"],
		},
	];
	for (const candidate of candidates) {
		try {
			const stdout = await run(
				candidate.command,
				candidate.args,
				MAX_CLIPBOARD_IMAGE_BYTES * 2,
			);
			if (stdout.length === 0) {
				continue;
			}
			return candidate.base64
				? toDataUrl(Buffer.from(stdout.toString("ascii").trim(), "base64"))
				: toDataUrl(stdout);
		} catch {}
	}
	return null;
};

/**
 * 读取系统剪贴板里的图片
 * @returns 剪贴板里没有图片、或当前环境拿不到时返回null
 */
export const readClipboardImage = async (): Promise<ClipboardImage | null> => {
	try {
		switch (process.platform) {
			case "win32": {
				return await readWindows();
			}
			default: {
				return await readLinux();
			}
		}
	} catch {
		return null;
	}
};
