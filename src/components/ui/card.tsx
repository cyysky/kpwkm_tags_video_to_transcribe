import React from 'react'

interface BaseProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Card({ className = '', ...props }: BaseProps) {
  return (
    <div
      className={`rounded-[1.125rem] border border-slate-200 bg-white/95 text-slate-950 shadow-[0_10px_34px_rgba(15,23,42,0.05)] ${className}`.trim()}
      {...props}
    />
  )
}

export function CardHeader({ className = '', ...props }: BaseProps) {
  return <div className={`border-b border-slate-200/80 px-6 py-4 ${className}`.trim()} {...props} />
}

export function CardContent({ className = '', ...props }: BaseProps) {
  return <div className={`px-6 py-6 ${className}`.trim()} {...props} />
}
