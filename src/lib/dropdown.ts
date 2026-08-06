/** 下拉弹层定位纯函数：固定定位 + 视口钳制 + 底部溢出翻转，供 Select 复用。 */

export const DROPDOWN_MIN_WIDTH = 240;
export const DROPDOWN_GAP = 4;
export const DROPDOWN_MARGIN = 8;
export const DROPDOWN_MAX_HEIGHT_RATIO = 0.6;

export interface DropdownAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface DropdownViewport {
  width: number;
  height: number;
}

export interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function dropdownPosition(
  anchor: DropdownAnchor,
  viewport: DropdownViewport,
  requestedWidth = DROPDOWN_MIN_WIDTH,
  gap = DROPDOWN_GAP,
  margin = DROPDOWN_MARGIN,
): DropdownPosition {
  const usableWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(Math.max(anchor.width, requestedWidth), usableWidth);
  const left = Math.max(
    margin,
    Math.min(anchor.left, viewport.width - width - margin),
  );

  const maxHeightCap = Math.round(viewport.height * DROPDOWN_MAX_HEIGHT_RATIO);
  const belowTop = anchor.bottom + gap;
  const aboveTop = Math.max(margin, anchor.top - gap);
  const availableBelow = viewport.height - margin - belowTop;
  const availableAbove = aboveTop - margin;
  const preferBelow =
    availableBelow >= Math.min(160, maxHeightCap) ||
    availableBelow >= availableAbove;
  const maxHeight = Math.min(
    maxHeightCap,
    Math.max(120, preferBelow ? availableBelow : availableAbove),
  );

  return {
    top: preferBelow ? belowTop : Math.max(margin, aboveTop - maxHeight),
    left,
    width,
    maxHeight,
  };
}
