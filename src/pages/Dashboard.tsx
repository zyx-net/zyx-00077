import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import {
  Users,
  AlertTriangle,
  Clock,
  CheckCircle,
  TrendingUp,
  Eye,
} from 'lucide-react';
import Layout from '@/components/Layout';
import StatCard from '@/components/StatCard';
import Loading from '@/components/Loading';
import AnomalyBadge from '@/components/AnomalyBadge';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import { AnomalyType } from '@/types';

const COLORS = ['#f97316', '#1e3a5f', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899'];

const anomalyLabels: Record<AnomalyType, string> = {
  late: '迟到',
  early_leave: '早退',
  missing_punch: '缺卡',
  missing_punch_in: '缺上班卡',
  missing_punch_out: '缺下班卡',
  cross_day: '跨日班次',
  duplicate: '重复打卡',
  leave_offset: '调休抵扣',
  overtime: '加班',
  timezone_error: '时区错误',
  no_schedule: '无排班',
  no_punch: '无打卡',
};

export default function Dashboard() {
  const { anomalies, schedules, currentBatchId, loading, initialized } = useAppStore();
  const { showToast } = useToast();

  const stats = useMemo(() => {
    const uniqueEmployees = new Set(schedules.map(s => s.employeeId)).size;
    const totalAnomalies = anomalies.length;
    const pendingAnomalies = anomalies.filter(a => a.status === 'pending').length;
    const correctedAnomalies = anomalies.filter(
      a => a.status === 'corrected' || a.status === 'ignored' || a.status === 'confirmed'
    ).length;
    const anomalyRate = uniqueEmployees > 0 
      ? ((totalAnomalies / uniqueEmployees) * 100).toFixed(1) 
      : '0';

    return {
      totalEmployees: uniqueEmployees,
      totalAnomalies,
      pendingAnomalies,
      correctedAnomalies,
      anomalyRate,
    };
  }, [anomalies, schedules]);

  const anomalyTypeData = useMemo(() => {
    const typeCount: Record<string, number> = {};
    anomalies.forEach(a => {
      const label = anomalyLabels[a.type] || a.type;
      typeCount[label] = (typeCount[label] || 0) + 1;
    });
    return Object.entries(typeCount)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [anomalies]);

  const trendData = useMemo(() => {
    const dateCount: Record<string, number> = {};
    const last14Days = [...Array(14)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      return d.toISOString().split('T')[0];
    });

    last14Days.forEach(date => {
      dateCount[date] = 0;
    });

    anomalies.forEach(a => {
      if (dateCount.hasOwnProperty(a.scheduleDate)) {
        dateCount[a.scheduleDate]++;
      }
    });

    return last14Days.map(date => ({
      date: date.slice(5),
      count: dateCount[date],
    }));
  }, [anomalies]);

  const departmentData = useMemo(() => {
    const deptCount: Record<string, number> = {};
    anomalies.forEach(a => {
      const dept = a.department || '未分配';
      deptCount[dept] = (deptCount[dept] || 0) + 1;
    });
    return Object.entries(deptCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [anomalies]);

  const recentAnomalies = useMemo(() => {
    return [...anomalies]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);
  }, [anomalies]);

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      pending: { label: '待处理', className: 'badge-warning' },
      corrected: { label: '已修正', className: 'badge-success' },
      ignored: { label: '已忽略', className: 'badge-secondary' },
      confirmed: { label: '已确认', className: 'badge-info' },
    };
    const cfg = config[status] || config.pending;
    return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
  };

  if (!initialized || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <Loading size="lg" text="加载中..." />
        </div>
      </Layout>
    );
  }

  if (!currentBatchId) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-96">
          <AlertTriangle size={48} className="text-[#f97316] mb-4" />
          <h3 className="text-xl font-semibold text-slate-800 mb-2">请先选择批次</h3>
          <p className="text-slate-500 mb-4">前往批次管理页面创建或选择一个批次</p>
          <button
            className="btn-primary"
            onClick={() => showToast('info', '请导航至批次管理页面')}
          >
            去选择批次
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            title="总员工数"
            value={stats.totalEmployees}
            icon={<Users size={24} />}
            color="blue"
            trend={5}
          />
          <StatCard
            title="总异常数"
            value={stats.totalAnomalies}
            icon={<AlertTriangle size={24} />}
            color="orange"
            trend={-3}
          />
          <StatCard
            title="待处理异常"
            value={stats.pendingAnomalies}
            icon={<Clock size={24} />}
            color="red"
            trend={8}
          />
          <StatCard
            title="已修正异常"
            value={stats.correctedAnomalies}
            icon={<CheckCircle size={24} />}
            color="green"
            trend={12}
          />
          <StatCard
            title="异常率"
            value={`${stats.anomalyRate}%`}
            icon={<TrendingUp size={24} />}
            color="purple"
            trend={-2}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">异常类型分布</h3>
            {anomalyTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={anomalyTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {anomalyTypeData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-slate-400">
                暂无数据
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">近期异常趋势</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="异常数"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ fill: '#f97316', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#f97316' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card p-5">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">部门异常排行</h3>
            {departmentData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={departmentData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" stroke="#64748b" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#64748b"
                    fontSize={12}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="count" name="异常数" fill="#1e3a5f" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-slate-400">
                暂无数据
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">最近异常</h3>
            {recentAnomalies.length > 0 ? (
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {recentAnomalies.map(anomaly => (
                  <div
                    key={anomaly.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <AnomalyBadge type={anomaly.type} />
                        {getStatusBadge(anomaly.status)}
                      </div>
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {anomaly.employeeName || anomaly.employeeId}
                      </p>
                      <p className="text-xs text-slate-500">{anomaly.scheduleDate}</p>
                    </div>
                    <button
                      className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                      onClick={() => showToast('info', '查看详情功能开发中')}
                    >
                      <Eye size={16} className="text-slate-500" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-slate-400">
                暂无异常记录
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
