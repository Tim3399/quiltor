import type { HTMLAttributes, ReactNode } from 'react';

export function Toolbar({ label, children, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div {...props} className={`ui-toolbar material-toolbar ${className}`.trim()} role="toolbar" aria-label={label}>{children}</div>;
}

export function ToolbarGroup({ align = 'start', children }: { align?: 'start' | 'end'; children: ReactNode }) {
  return <div className="ui-toolbar__group" data-align={align}>{children}</div>;
}
