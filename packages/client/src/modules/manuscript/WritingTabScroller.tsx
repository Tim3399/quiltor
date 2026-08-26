import { type FocusEvent, type ReactNode, useEffect, useRef } from "react";
import { ScrollArea } from "../../design";

interface WritingTabScrollerProps {
  children: ReactNode;
  className?: string;
  selectedValue: string;
}

function revealTab(tab: Element | null) {
  if (tab && typeof tab.scrollIntoView === "function") {
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

export function WritingTabScroller({
  children,
  className = "",
  selectedValue,
}: WritingTabScrollerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedValue) return;
    revealTab(scrollAreaRef.current?.querySelector('[role="tab"][aria-selected="true"]') ?? null);
  }, [selectedValue]);

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (tab && scrollAreaRef.current?.contains(tab)) revealTab(tab);
  };

  return (
    <ScrollArea
      ref={scrollAreaRef}
      axis="x"
      gutter="auto"
      overscroll="contain"
      scrollbar="thin"
      surface="transparent"
      className={["writing-tab-scroll", className].filter(Boolean).join(" ")}
      onFocusCapture={handleFocusCapture}
    >
      {children}
    </ScrollArea>
  );
}
