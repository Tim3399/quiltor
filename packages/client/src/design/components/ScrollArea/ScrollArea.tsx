import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  type ElementType,
  type ForwardedRef,
  forwardRef,
  type ReactElement,
} from "react";
import "./ScrollArea.css";

export type ScrollAreaAxis = "y" | "x" | "both";
export type ScrollAreaGutter = "auto" | "stable" | "both-edges";
export type ScrollAreaOverscroll = "auto" | "contain";
export type ScrollAreaScrollbar = "thin" | "hidden" | "native";
export type ScrollAreaSurface = "canvas" | "paper" | "panel" | "transparent";

type ScrollAreaOwnProps<TElement extends ElementType> = {
  as?: TElement;
  axis?: ScrollAreaAxis;
  gutter?: ScrollAreaGutter;
  overscroll?: ScrollAreaOverscroll;
  scrollbar?: ScrollAreaScrollbar;
  surface?: ScrollAreaSurface;
};

export type ScrollAreaProps<TElement extends ElementType = "div"> = ScrollAreaOwnProps<TElement> &
  Omit<ComponentPropsWithoutRef<TElement>, keyof ScrollAreaOwnProps<TElement>>;

type ScrollAreaComponent = <TElement extends ElementType = "div">(
  props: ScrollAreaProps<TElement> & { ref?: ComponentPropsWithRef<TElement>["ref"] },
) => ReactElement | null;

function ScrollAreaImplementation(
  {
    as,
    axis = "y",
    gutter = "stable",
    overscroll = "contain",
    scrollbar = "thin",
    surface = "transparent",
    className,
    ...props
  }: ScrollAreaProps<ElementType>,
  ref: ForwardedRef<HTMLElement>,
) {
  const Component: ElementType = as ?? "div";

  return (
    <Component
      {...props}
      ref={ref}
      className={["scroll-area", className].filter(Boolean).join(" ")}
      data-axis={axis}
      data-gutter={gutter}
      data-overscroll={overscroll}
      data-scrollbar={scrollbar}
      data-surface={surface}
    />
  );
}

export const ScrollArea = forwardRef(ScrollAreaImplementation) as unknown as ScrollAreaComponent;
