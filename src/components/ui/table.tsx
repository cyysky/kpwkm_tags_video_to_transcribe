import React from 'react'

interface Props extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

export function Table({ children, className = '' }: Props) {
  return (
    <div
      className={`relative w-full overflow-auto rounded-[1.125rem] border border-slate-200 bg-white/95 shadow-[0_8px_28px_rgba(15,23,42,0.05)] ${className}`.trim()}
    >
      <table className="w-full caption-bottom border-collapse text-sm">{children}</table>
    </div>
  )
}

export function TableHeader({ children, className = '' }: Props) {
  return <thead className={`bg-slate-50/90 [&_tr]:border-b [&_tr]:border-slate-200/80 ${className}`.trim()}>{children}</thead>
}

export function TableBody({ children, className = '' }: Props) {
  return <tbody className={`[&_tr:last-child]:border-0 ${className}`.trim()}>{children}</tbody>
}

export function TableRow({ children, className = '' }: Props) {
  return (
    <tr className={`border-b border-slate-200/80 transition-colors hover:bg-blue-50/40 ${className}`.trim()}>{children}</tr>
  )
}

export function TableHead({ children, className = '' }: Props) {
  return (
    <th
      className={`h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 ${className}`.trim()}
    >
      {children}
    </th>
  )
}

export function TableCell({ children, className = '' }: Props) {
  return <td className={`px-4 py-3.5 align-middle text-sm text-slate-700 ${className}`.trim()}>{children}</td>
}
