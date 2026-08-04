import { Field } from "./Field";
import type { InputSize } from "./Input";
import { TimeSelect } from "./TimeSelect";

/**
 * 时间对字段：开始与结束各用紧凑的自定义 TimeSelect（5 分钟粒度），
 * 中间用连接符（如“至”）连接，不再拉伸整行。
 */
export function TimeRangeField({
  startLabel,
  endLabel,
  connector,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  startId,
  endId,
  size = "sm",
  startInvalid = false,
  endInvalid = false,
}: {
  startLabel: string;
  endLabel: string;
  connector: string;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  startId?: string;
  endId?: string;
  size?: InputSize;
  startInvalid?: boolean;
  endInvalid?: boolean;
}) {
  return (
    <div className="flex items-end gap-2">
      <Field label={startLabel} htmlFor={startId}>
        <TimeSelect
          id={startId}
          size={size}
          ariaLabel={startLabel}
          value={startValue}
          onChange={onStartChange}
          invalid={startInvalid}
        />
      </Field>
      <span className="pb-2.5 text-xs text-muted">{connector}</span>
      <Field label={endLabel} htmlFor={endId}>
        <TimeSelect
          id={endId}
          size={size}
          ariaLabel={endLabel}
          value={endValue}
          onChange={onEndChange}
          invalid={endInvalid}
        />
      </Field>
    </div>
  );
}
