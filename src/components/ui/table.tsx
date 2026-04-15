import React from 'react'

interface Props extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

export function Table({ children, className = '' }: Props) {
  return (
    <div className={`overflow-hidden rounded-[1.125rem] border border-slate-200 bg-white/95 shadow-sm ${className}`.trim()}>
      <table className="w-full caption-bottom text-sm text-slate-700">{children}</table>
    </div>
  )
}

export function TableHeader({ children, className = '' }: Props) {
  return <thead className={`border-b border-slate-200/80 bg-slate-50/70 ${className}`.trim()}>{children}</thead>
}

export function TableBody({ children, className = '' }: Props) {
  return <tbody className={className}>{children}</tbody>
}

export function TableRow({ children, className = '' }: Props) {
  return <tr className={`border-b border-slate-200/70 transition hover:bg-slate-50 ${className}`.trim()}>{children}</tr>
}

export function TableHead({ children, className = '' }: Props) {
  return (
    <th className={`h-11 px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 ${className}`.trim()}>
      {children}
    </th>
  )
}

export function TableCell({ children, className = '' }: Props) {
  return <td className={`p-4 align-middle text-sm text-slate-700 ${className}`.trim()}>{children}</td>
}
