/** @fileoverview Defines the shared visual and interaction states for First Chord admin buttons and button-like links. */

const BASE_CLASSES = [
  'inline-flex',
  'select-none',
  'items-center',
  'justify-center',
  'gap-2',
  'rounded-lg',
  'border',
  'font-semibold',
  'shadow-sm',
  'transition-[color,background-color,border-color,box-shadow,translate,scale]',
  'duration-150',
  'ease-out',
  'active:translate-y-px',
  'active:scale-[0.98]',
  'active:shadow-inner',
  'focus-visible:outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-sky-500',
  'focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed',
  'disabled:opacity-60',
  'motion-reduce:active:translate-y-0',
  'motion-reduce:active:scale-100',
  'motion-reduce:transition-none',
].join(' ');

const VARIANT_CLASSES = {
  primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700 active:bg-slate-950',
  secondary: 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-100 active:bg-slate-200',
  quiet: 'border-transparent bg-transparent text-slate-700 shadow-none hover:bg-slate-100 active:bg-slate-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300 hover:bg-amber-100 active:bg-amber-200',
  danger: 'border-red-200 bg-white text-red-800 hover:border-red-300 hover:bg-red-50 active:bg-red-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 active:bg-emerald-100',
  blue: 'border-blue-200 bg-blue-50 text-blue-900 hover:border-blue-300 hover:bg-blue-100 active:bg-blue-200',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100 active:bg-emerald-200',
  red: 'border-red-200 bg-white text-red-800 hover:border-red-300 hover:bg-red-50 active:bg-red-100',
  subtle: 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:bg-slate-200',
};

const SIZE_CLASSES = {
  compact: 'min-h-8 px-3 py-1.5 text-xs',
  default: 'min-h-11 px-4 py-2 text-sm',
  large: 'min-h-12 px-5 py-2.5 text-base',
};

export function getButtonClassName({
  variant = 'primary',
  size = 'default',
  className = '',
} = {}) {
  const variantClass = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.default;

  return `${BASE_CLASSES} ${sizeClass} ${variantClass} ${className}`.trim();
}
