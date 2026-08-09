import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { computeVirtualRange } from "../lib/virtual";

/**
 * 固定行高虚拟列表（自研轻量，零依赖）：
 * 以“滚动容器（main 或视口）capture 滚动事件 + 容器定位”计算可见行区间，
 * 只渲染可见行，用占位高度保持滚动条尺寸稳定。
 */
export function VirtualRows({
  total,
  rowHeight,
  overscan = 5,
  renderRow,
}: {
  total: number;
  rowHeight: number;
  overscan?: number;
  renderRow: (index: number) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(total, 20) });

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scroller = el.closest("main") ?? document.documentElement;
    const scrollTop =
      "scrollTop" in scroller ? scroller.scrollTop : window.scrollY;
    const scrollerRect = scroller.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const listTop = scrollTop + rect.top - scrollerRect.top;
    const viewport = scroller.clientHeight || window.innerHeight || 600;
    const next = computeVirtualRange({
      scrollTop,
      listTop,
      viewport,
      rowHeight,
      total,
      overscan,
    });
    setRange(next);
  }, [rowHeight, total, overscan]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const onScroll = () => update();
    // capture 阶段捕获 main 等后代滚动容器的滚动
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(onScroll)
        : null;
    if (observer && containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      observer?.disconnect();
    };
  }, [update]);

  const rows: ReactNode[] = [];
  for (let index = range.start; index < range.end; index++) {
    rows.push(
      <div
        key={index}
        role="listitem"
        style={{
          position: "absolute",
          top: index * rowHeight,
          left: 0,
          right: 0,
          height: rowHeight,
        }}
        className="overflow-hidden"
      >
        {renderRow(index)}
      </div>,
    );
  }

  return (
    <div ref={containerRef} role="list" className="relative">
      <div style={{ height: total * rowHeight }} />
      {rows}
    </div>
  );
}
