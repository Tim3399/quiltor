import type { HTMLAttributes } from "react";
export function Sidebar(props: HTMLAttributes<HTMLElement>) {
  return <aside {...props} className={`ui-sidebar ${props.className || ""}`.trim()} />;
}
export function Inspector(props: HTMLAttributes<HTMLElement>) {
  return <aside {...props} className={`ui-inspector ${props.className || ""}`.trim()} />;
}
