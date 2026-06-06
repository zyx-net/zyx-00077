import { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  color: 'blue' | 'green' | 'orange' | 'red' | 'purple';
  trend?: number;
  trendLabel?: string;
}

const colorClasses = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-red-50 text-red-600',
  purple: 'bg-purple-50 text-purple-600',
};

export default function StatCard({ title, value, icon, color, trend, trendLabel }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-800">{value}</p>
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {trend > 0 ? (
                <TrendingUp size={14} className="text-red-500" />
              ) : trend < 0 ? (
                <TrendingDown size={14} className="text-green-500" />
              ) : (
                <Minus size={14} className="text-slate-400" />
              )}
              <span
                className={`text-xs ${
                  trend > 0
                    ? 'text-red-500'
                    : trend < 0
                    ? 'text-green-500'
                    : 'text-slate-400'
                }`}
              >
                {Math.abs(trend)}% {trendLabel || '较上期'}
              </span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
