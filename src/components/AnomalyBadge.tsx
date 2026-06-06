import { AnomalyType } from '@/types';

interface AnomalyBadgeProps {
  type: AnomalyType;
  showLabel?: boolean;
}

const anomalyConfig: Record<AnomalyType, { label: string; className: string }> = {
  late: { label: '迟到', className: 'badge-warning' },
  early_leave: { label: '早退', className: 'badge-warning' },
  missing_punch: { label: '缺卡', className: 'badge-danger' },
  missing_punch_in: { label: '缺上班卡', className: 'badge-danger' },
  missing_punch_out: { label: '缺下班卡', className: 'badge-danger' },
  cross_day: { label: '跨日班次', className: 'badge-info' },
  duplicate: { label: '重复打卡', className: 'badge-secondary' },
  leave_offset: { label: '调休抵扣', className: 'badge-success' },
  overtime: { label: '加班', className: 'badge-info' },
  timezone_error: { label: '时区错误', className: 'badge-danger' },
  no_schedule: { label: '无排班', className: 'badge-warning' },
  no_punch: { label: '无打卡', className: 'badge-danger' },
};

export default function AnomalyBadge({ type, showLabel = true }: AnomalyBadgeProps) {
  const config = anomalyConfig[type] || { label: type, className: 'badge-secondary' };
  
  if (!showLabel) {
    return <span className={`status-dot ${
      type.includes('missing') || type === 'timezone_error' || type === 'no_punch'
        ? 'danger'
        : type === 'late' || type === 'early_leave' || type === 'no_schedule'
        ? 'warning'
        : type === 'leave_offset'
        ? 'success'
        : 'info'
    }`} />;
  }
  
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}
