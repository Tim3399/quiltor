import { type MutableRefObject, useInsertionEffect, useRef } from "react";

/**
 * A ref that always holds the value of the latest committed render.
 *
 * For callbacks and effects that must read the newest value without re-subscribing. The
 * value is assigned in an insertion effect, never during render: insertion effects run
 * before every layout effect of the same commit, so a child's layout effect, a ref
 * callback, a passive effect and any event handler all already see it.
 *
 * Name the result `…Ref` (`const draftRef = useLatest(draft)`): react-hooks/refs recognises
 * refs by that name and keeps reporting reads during render. A handler may write the ref
 * only to move ahead the value it is passing on (`onChange(next); draftRef.current = next`),
 * so a second synchronous call before the next commit sees it; the next commit overwrites
 * it with the prop again. See design/README.md, "Latest-value refs".
 */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
