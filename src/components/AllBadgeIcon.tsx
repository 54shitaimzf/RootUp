/**
 * ALL 徽章（筛选“全部”）：与其它图标同源保存——独立组件、currentColor、
 * className 控制尺寸，供 FilterBar / 自动补全复用。
 * 视觉已减脂：细圆环（1.1）+ 中等字重（700）+ 收紧字距，小尺寸保持可读。
 */
export function AllBadgeIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      className={className}
    >
      <circle
        cx="9"
        cy="9"
        r="7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <text
        x="9"
        y="11.6"
        textAnchor="middle"
        fontSize="7.6"
        fontWeight="700"
        letterSpacing="0.04em"
        fill="currentColor"
      >
        ALL
      </text>
    </svg>
  );
}
