import { Field } from "./Field";
import { Input, type InputSize } from "./Input";

/**
 * 时间对字段：开始与结束作为一组语义单元，中间用连接符（如“至”）连接。
 * 两个输入框等宽（flex-1），标签保持与 Field 一致的文字层级。
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
}) {
  return (
    <div className="flex items-end gap-2">
      <Field label={startLabel} htmlFor={startId} className="flex-1">
        <Input
          id={startId}
          size={size}
          type="time"
          value={startValue}
          onChange={(event) => onStartChange(event.target.value)}
        />
      </Field>
      <span className="pb-2.5 text-xs text-muted">{connector}</span>
      <Field label={endLabel} htmlFor={endId} className="flex-1">
        <Input
          id={endId}
          size={size}
          type="time"
          value={endValue}
          onChange={(event) => onEndChange(event.target.value)}
        />
      </Field>
    </div>
  );
}
