/**
 * 图标消费唯一入口（皮肤接入点）。
 *
 * 组件与数据注册表一律从这里具名导入图标，禁止直连 lucide-react
 * （`npm run check:arch` 门禁强制，白名单仅本文件）。
 * v1.3 Iris 皮肤替换图标集时只需替换本模块的再导出实现，组件零改动。
 * 具名再导出不影响 tree-shaking：构建产物只包含实际引用的图标。
 */
export * from "lucide-react";
