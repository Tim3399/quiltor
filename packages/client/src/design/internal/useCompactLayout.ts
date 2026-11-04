import { useEffect, useState } from "react";

const compactQuery = "(max-width: 719px)";

/** Whether the viewport uses the compact layout, where anchored overlays become sheets. */
export function useCompactLayout() {
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia(compactQuery).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(compactQuery);
    const change = () => setCompact(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return compact;
}
