import { Loader2 } from 'lucide-react';

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  fullScreen?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export default function Loading({ size = 'md', text, fullScreen = false }: LoadingProps) {
  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className={`animate-spin text-[#1e3a5f] ${sizeClasses[size]}`} />
          {text && <p className="text-slate-600 text-sm">{text}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Loader2 className={`animate-spin text-[#1e3a5f] ${sizeClasses[size]}`} />
      {text && <span className="text-slate-600 text-sm">{text}</span>}
    </div>
  );
}
