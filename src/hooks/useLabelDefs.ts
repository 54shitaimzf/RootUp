import { useEffect, useState } from "react";
import { listLabelDefs, type LabelDef } from "../lib/tauri";

/** 自定义标签注册表（加载失败回退空表，不影响既有展示）。 */
export function useLabelDefs() {
  const [defs, setDefs] = useState<Record<string, LabelDef>>({});

  useEffect(() => {
    let alive = true;
    listLabelDefs()
      .then((items) => {
        if (alive) {
          setDefs(Object.fromEntries(items.map((def) => [def.key, def])));
        }
      })
      .catch(() => {
        if (alive) setDefs({});
      });
    return () => {
      alive = false;
    };
  }, []);

  return defs;
}
