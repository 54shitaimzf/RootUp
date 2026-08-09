/** 固定行高虚拟列表的纯计算（0.8.6 自研轻量实现，零依赖）。 */

export interface VirtualRange {
  start: number;
  end: number;
}

export interface VirtualRangeInput {
  /** 滚动容器当前 scrollTop */
  scrollTop: number;
  /** 列表顶部在滚动内容中的 y 坐标 */
  listTop: number;
  /** 滚动容器可视高度 */
  viewport: number;
  rowHeight: number;
  total: number;
  overscan?: number;
}

export function computeVirtualRange({
  scrollTop,
  listTop,
  viewport,
  rowHeight,
  total,
  overscan = 5,
}: VirtualRangeInput): VirtualRange {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const first = Math.floor((scrollTop - listTop) / rowHeight);
  const visible = Math.max(0, Math.ceil(viewport / rowHeight));
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return { start, end };
}
