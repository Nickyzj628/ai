// ================================
// 仅在内部可用的便捷方法
// ================================

const formatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** 把数字转换成千分位 */
export const humanizeNumber = (number: number) => {
	return formatter.format(number);
};
