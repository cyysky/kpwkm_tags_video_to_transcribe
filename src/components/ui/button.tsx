import React from 'react'

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive'
type ButtonSize = 'default' | 'sm'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-blue-700 text-white shadow-[0_10px_28px_rgba(29,78,216,0.25)] hover:bg-blue-800',
  outline:
    'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50/80 hover:text-slate-900',
  destructive: 'border border-transparent bg-red-600 text-white shadow-[0_10px_24px_rgba(220,38,38,0.22)] hover:bg-red-700',
}

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-9 px-3 text-xs',
}

export function Button({
  variant = 'outline',
  size = 'default',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim()}
      {...props}
    />
  )
}
