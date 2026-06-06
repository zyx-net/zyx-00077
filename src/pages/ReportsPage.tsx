import { useState, useMemo } from 'react';
import {
  FileBarChart,
  Download,
  FileText,
  FileSpreadsheet,
  FileCode,
  Eye,
  Calendar,
  Users,
  Building2,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  History,
  BarChart3,
  PieChart,
  X,
} from 'lucide-react';
import {
  PieChart as RechartsPie,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Layout from '@/components/Layout';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import AnomalyBadge from '@/components/AnomalyBadge';
import StatCard from '@/components/StatCard';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import exportModule from '@/modules/export';
import statsModule from '@/modules/stats';
import type { ExportOptions, ReportData, AnomalyType } from '@/types';

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

interface HistoryReport {
  id: string;
  name: string;
  batchName: string;
  createdAt: Date;
  format: string;
  fileSize: string;
}

export default function ReportsPage() {
  const {
    anomalies,
    corrections,
    currentBatchId,
    batches,
    activeRuleVersion,
    schedules,
    loading,
  } = useAppStore();
  const { showToast } = useToast();

  const [exportFormat, setExportFormat] = useState<ExportOptions['format']>('html');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeCorrections, setIncludeCorrections] = useState(true);
  const [reportTitle, setReportTitle] = useState('排班考勤异常对账分析报告');
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'byType' | 'byDept' | 'byEmployee' | 'byDate'>('overview');
  const [historyReports, setHistoryReports] = useState<HistoryReport[]>([]);

  const currentBatch = batches.find(b => b.id === currentBatchId);

  const stats = useMemo(() => {
    if (!currentBatchId) return null;
    return statsModule.calculateSummary(anomalies);
  }, [anomalies, corrections, currentBatchId]);

  const reportData = useMemo((): ReportData | null => {
    if (!stats || !currentBatch) return null;

    const trendData = [...Array(14)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const dateStr = d.toISOString().split('T')[0];
      const count = anomalies.filter(a => a.scheduleDate === dateStr).length;
      return { date: dateStr.slice(5), count };
    });

    const employeeStats = useMemo(() => {
      const empMap = new Map<string, { employeeId: string; employeeName: string; count: number }>();
      anomalies.forEach(a => {
        const key = a.employeeId;
        const existing = empMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          empMap.set(key, {
            employeeId: a.employeeId,
            employeeName: a.employeeName || a.employeeId,
            count: 1,
          });
        }
      });
      return Array.from(empMap.values()).sort((a, b) => b.count - a.count).slice(0, 20);
    }, [anomalies]);

    const departmentStats = useMemo(() => {
      const deptMap = new Map<string, number>();
      anomalies.forEach(a => {
        const dept = a.department || '未分配';
        deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
      });
      return Array.from(deptMap.entries())
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count);
    }, [anomalies]);

    return {
      batch: currentBatch,
      summary: stats,
      anomalies,
      corrections,
      trendData,
      employeeStats,
      departmentStats,
      ruleVersion: activeRuleVersion || undefined,
    };
  }, [stats, currentBatch, anomalies, corrections, activeRuleVersion]);

  const typeData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.anomaliesByType)
      .filter(([_, count]) => count > 0 && _ !== 'leave_offset')
      .map(([type, count]) => ({
        name: anomalyLabels[type as AnomalyType] || type,
        value: count,
      }))
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const severityData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.anomaliesBySeverity)
      .filter(([_, count]) => count > 0)
      .map(([severity, count]) => ({
        name: severity === 'low' ? '低' : severity === 'medium' ? '中' : severity === 'high' ? '高' : '严重',
        value: count,
      }));
  }, [stats]);

  const handleExport = async () => {
    if (!reportData) {
      showToast('error', '没有可导出的数据');
      return;
    }

    setIsExporting(true);
    try {
      const options: ExportOptions = {
        format: exportFormat,
        includeCharts,
        includeCorrections,
        title: reportTitle,
        generatedAt: new Date(),
      };

      let content: string | Blob;
      let filename: string;
      const timestamp = new Date().toISOString().slice(0, 10);

      switch (exportFormat) {
        case 'html':
          content = exportModule.generateHTMLReport(reportData, options);
          filename = `考勤异常报告_${timestamp}.html`;
          break;
        case 'markdown':
          content = exportModule.generateMarkdownReport(reportData, options);
          filename = `考勤异常报告_${timestamp}.md`;
          break;
        case 'excel':
          content = exportModule.generateExcelReport(reportData, options);
          filename = `考勤异常报告_${timestamp}.xlsx`;
          break;
        case 'csv':
          content = exportModule.generateCSVReport(reportData, options);
          filename = `考勤异常报告_${timestamp}.csv`;
          break;
        default:
          throw new Error('不支持的导出格式');
      }

      exportModule.downloadReport(content, filename, exportFormat);

      const fileSize = typeof content === 'string' 
        ? `${(content.length / 1024).toFixed(1)} KB`
        : `${(content.size / 1024).toFixed(1)} KB`;

      setHistoryReports(prev => [
        {
          id: Date.now().toString(),
          name: reportTitle,
          batchName: currentBatch?.name || '',
          createdAt: new Date(),
          format: exportFormat.toUpperCase(),
          fileSize,
        },
        ...prev,
      ]);

      showToast('success', `报告已导出：${filename}`);
    } catch (error) {
      showToast('error', '导出失败');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePreview = async () => {
    if (!reportData) {
      showToast('error', '没有可预览的数据');
      return;
    }

    try {
      const options: ExportOptions = {
        format: 'html',
        includeCharts,
        includeCorrections,
        title: reportTitle,
        generatedAt: new Date(),
      };

      const content = exportModule.generateHTMLReport(reportData, options);
      setPreviewContent(content);
      setShowPreview(true);
    } catch (error) {
      showToast('error', '生成预览失败');
    }
  };

  const formatOptions = [
    { value: 'html', label: 'HTML报告', icon: FileText, desc: '适合浏览器查看，包含图表' },
    { value: 'markdown', label: 'Markdown报告', icon: FileCode, desc: '适合文档系统，轻量易读' },
    { value: 'excel', label: 'Excel报告', icon: FileSpreadsheet, desc: '适合数据分析，多工作表' },
    { value: 'csv', label: 'CSV报告', icon: FileSpreadsheet, desc: '适合数据导入，通用格式' },
  ];

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <Loading size="lg" text="加载中..." />
        </div>
      </Layout>
    );
  }

  if (!currentBatchId || !stats) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-96">
          <FileBarChart size={48} className="text-[#f97316] mb-4" />
          <h3 className="text-xl font-semibold text-slate-800 mb-2">暂无报告数据</h3>
          <p className="text-slate-500">请先导入数据并进行异常分析</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">统计报告</h3>
            <p className="text-sm text-slate-500">
              批次: {currentBatch?.name} · 共 {stats.totalAnomalies} 条异常
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="异常总数"
            value={stats.totalAnomalies}
            icon={<AlertTriangle size={24} />}
            color="orange"
          />
          <StatCard
            title="待处理"
            value={stats.pendingCorrections}
            icon={<Clock size={24} />}
            color="red"
          />
          <StatCard
            title="解决率"
            value={`${stats.resolutionRate.toFixed(1)}%`}
            icon={<CheckCircle size={24} />}
            color="green"
          />
        </div>

        <div className="card">
          <div className="flex border-b border-slate-200">
            {[
              { key: 'overview', label: '概览', icon: FileBarChart },
              { key: 'byType', label: '按类型', icon: PieChart },
              { key: 'byDept', label: '按部门', icon: Building2 },
              { key: 'byEmployee', label: '按员工', icon: Users },
              { key: 'byDate', label: '按日期', icon: Calendar },
            ].map(tab => (
              <button
                key={tab.key}
                className={`px-6 py-4 text-sm font-medium transition-colors flex items-center gap-2 ${
                  activeTab === tab.key
                    ? 'text-[#1e3a5f] border-b-2 border-[#1e3a5f] bg-slate-50'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <PieChart size={18} />
                    异常类型分布
                  </h4>
                  {typeData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <RechartsPie>
                        <Pie
                          data={typeData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {typeData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </RechartsPie>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-slate-400">
                      暂无数据
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <BarChart3 size={18} />
                    严重程度分布
                  </h4>
                  {severityData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={severityData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip />
                        <Bar
                          dataKey="value"
                          name="数量"
                          fill="#1e3a5f"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-slate-400">
                      暂无数据
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2 p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
                    <TrendingUp size={18} />
                    处理状态分布
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 mb-1">待处理</div>
                      <div className="text-2xl font-bold text-amber-600">
                        {stats.pendingCorrections}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 mb-1">已修正</div>
                      <div className="text-2xl font-bold text-green-600">
                        {stats.correctedCount}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 mb-1">已忽略</div>
                      <div className="text-2xl font-bold text-slate-600">
                        {stats.ignoredCount}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <div className="text-sm text-slate-500 mb-1">已确认</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {stats.confirmedCount}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'byType' && (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>异常类型</th>
                      <th>数量</th>
                      <th>占比</th>
                      <th>待处理</th>
                      <th>已处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeData.map((item, idx) => {
                      const type = Object.entries(anomalyLabels).find(
                        ([_, label]) => label === item.name
                      )?.[0] as AnomalyType;
                      const typeAnomalies = anomalies.filter(a => a.type === type);
                      const pending = typeAnomalies.filter(a => a.status === 'pending').length;
                      return (
                        <tr key={idx}>
                          <td>
                            {type && <AnomalyBadge type={type} />}
                          </td>
                          <td className="font-medium">{item.value as number}</td>
                          <td>
                            {stats.totalAnomalies > 0
                              ? `${(((item.value as number) / stats.totalAnomalies) * 100).toFixed(1)}%`
                              : '0%'}
                          </td>
                          <td>
                            <span className="text-amber-600">{pending}</span>
                          </td>
                          <td>
                            <span className="text-green-600">{(item.value as number) - pending}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'byDept' && (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>部门</th>
                      <th>异常数</th>
                      <th>占比</th>
                      <th>员工数</th>
                      <th>人均异常</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData?.departmentStats?.map((item, idx) => {
                      const deptEmployees = new Set(
                        anomalies
                          .filter(a => (a.department || '未分配') === item.department)
                          .map(a => a.employeeId)
                      ).size;
                      return (
                        <tr key={idx}>
                          <td className="font-medium">{item.department}</td>
                          <td className="font-medium">{item.count}</td>
                          <td>
                            {stats.totalAnomalies > 0
                              ? `${((item.count / stats.totalAnomalies) * 100).toFixed(1)}%`
                              : '0%'}
                          </td>
                          <td>{deptEmployees}</td>
                          <td>{(item.count / deptEmployees).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'byEmployee' && (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>排名</th>
                      <th>员工编号</th>
                      <th>员工姓名</th>
                      <th>部门</th>
                      <th>异常数</th>
                      <th>待处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData?.employeeStats?.map((item, idx) => {
                      const empAnomalies = anomalies.filter(
                        a => a.employeeId === item.employeeId
                      );
                      const pending = empAnomalies.filter(a => a.status === 'pending').length;
                      const dept = empAnomalies[0]?.department || '-';
                      return (
                        <tr key={idx}>
                          <td>
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                                idx < 3
                                  ? 'bg-[#f97316] text-white'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {idx + 1}
                            </span>
                          </td>
                          <td>{item.employeeId}</td>
                          <td className="font-medium">{item.employeeName}</td>
                          <td>{dept}</td>
                          <td className="font-medium">{item.count}</td>
                          <td>
                            {pending > 0 ? (
                              <span className="text-amber-600">{pending}</span>
                            ) : (
                              <CheckCircle size={16} className="text-green-500" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'byDate' && (
              <div className="space-y-4">
                {reportData?.trendData?.map((item, idx) => {
                  const dateAnomalies = anomalies.filter(
                    a => a.scheduleDate.slice(5) === item.date
                  );
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg"
                    >
                      <div className="w-20 text-sm font-medium text-slate-700">
                        {item.date}
                      </div>
                      <div className="flex-1">
                        <div className="w-full bg-slate-200 rounded-full h-6 overflow-hidden">
                          <div
                            className="bg-[#1e3a5f] h-full flex items-center justify-end pr-2 transition-all"
                            style={{
                              width: `${item.count > 0 ? Math.max((item.count / Math.max(...(reportData?.trendData?.map(d => d.count) || [1]))) * 100, 10) : 0}%`,
                            }}
                          >
                            {item.count > 0 && (
                              <span className="text-white text-xs font-medium">
                                {item.count}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {dateAnomalies.slice(0, 3).map((a, i) => (
                          <AnomalyBadge key={i} type={a.type} showLabel={false} />
                        ))}
                        {dateAnomalies.length > 3 && (
                          <span className="text-xs text-slate-500">
                            +{dateAnomalies.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card p-6">
          <h4 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
            <Download size={18} />
            导出报告
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  报告标题
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={reportTitle}
                  onChange={e => setReportTitle(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">
                  导出格式
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {formatOptions.map(option => (
                    <label
                      key={option.value}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                        exportFormat === option.value
                          ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={option.value}
                        checked={exportFormat === option.value}
                        onChange={e =>
                          setExportFormat(e.target.value as ExportOptions['format'])
                        }
                        className="sr-only"
                      />
                      <div className="flex items-center gap-2">
                        <option.icon
                          size={20}
                          className={
                            exportFormat === option.value
                              ? 'text-[#1e3a5f]'
                              : 'text-slate-400'
                          }
                        />
                        <div>
                          <div
                            className={`text-sm font-medium ${
                              exportFormat === option.value
                                ? 'text-[#1e3a5f]'
                                : 'text-slate-700'
                            }`}
                          >
                            {option.label}
                          </div>
                          <div className="text-xs text-slate-500">{option.desc}</div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCharts}
                    onChange={e => setIncludeCharts(e.target.checked)}
                    className="w-4 h-4 text-[#1e3a5f] rounded"
                  />
                  <span className="text-sm text-slate-700">包含图表</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCorrections}
                    onChange={e => setIncludeCorrections(e.target.checked)}
                    className="w-4 h-4 text-[#1e3a5f] rounded"
                  />
                  <span className="text-sm text-slate-700">包含修正记录</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col justify-between">
              <div className="p-4 bg-slate-50 rounded-lg">
                <h5 className="font-medium text-slate-800 mb-2">报告摘要</h5>
                <div className="space-y-1 text-sm text-slate-600">
                  <p>• 批次：{currentBatch?.name}</p>
                  <p>• 异常总数：{stats.totalAnomalies} 条</p>
                  <p>• 待处理：{stats.pendingCorrections} 条</p>
                  <p>• 修正记录：{corrections.length} 条</p>
                  <p>• 解决率：{stats.resolutionRate.toFixed(1)}%</p>
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  className="btn-secondary flex-1"
                  onClick={handlePreview}
                  disabled={isExporting}
                >
                  <Eye size={16} className="inline mr-1" />
                  预览
                </button>
                <button
                  className="btn-primary flex-1"
                  onClick={handleExport}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <>
                      <Loading size="sm" />
                      <span className="ml-2">导出中...</span>
                    </>
                  ) : (
                    <>
                      <Download size={16} className="inline mr-1" />
                      导出
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {historyReports.length > 0 && (
          <div className="card p-6">
            <h4 className="font-medium text-slate-800 mb-4 flex items-center gap-2">
              <History size={18} />
              历史报告
            </h4>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>报告名称</th>
                    <th>批次</th>
                    <th>格式</th>
                    <th>大小</th>
                    <th>生成时间</th>
                  </tr>
                </thead>
                <tbody>
                  {historyReports.map(report => (
                    <tr key={report.id}>
                      <td className="font-medium">{report.name}</td>
                      <td>{report.batchName}</td>
                      <td>
                        <span className="badge badge-info">{report.format}</span>
                      </td>
                      <td>{report.fileSize}</td>
                      <td className="text-sm text-slate-500">
                        {new Date(report.createdAt).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        title="报告预览"
        size="xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowPreview(false)}>
              <X size={16} className="inline mr-1" />
              关闭
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setShowPreview(false);
                handleExport();
              }}
              disabled={isExporting}
            >
              <Download size={16} className="inline mr-1" />
              导出
            </button>
          </>
        }
      >
        <div className="border border-slate-200 rounded-lg overflow-hidden h-[60vh]">
          <iframe
            srcDoc={previewContent}
            className="w-full h-full"
            title="报告预览"
          />
        </div>
      </Modal>
    </Layout>
  );
}
