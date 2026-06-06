import { useState, useMemo, useEffect } from 'react';
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
  RotateCcw,
  AlertCircle,
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
import auditModule from '@/modules/audit';
import type { ExportOptions, ReportData, AnomalyType, AuditExportSnapshot, RestoreCheckResult } from '@/types';

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
    auditLogs,
    exportSnapshots,
    loading,
    loadAuditLogs,
    loadExportSnapshots,
    recordAuditLog,
    getCurrentStatsSnapshot,
    createExportSnapshot,
    checkRestoreConflicts,
    restoreToSnapshot,
  } = useAppStore();
  const { showToast } = useToast();

  const [exportFormat, setExportFormat] = useState<ExportOptions['format']>('html');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeCorrections, setIncludeCorrections] = useState(true);
  const [includeAuditSummary, setIncludeAuditSummary] = useState(false);
  const [reportTitle, setReportTitle] = useState('排班考勤异常对账分析报告');
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'byType' | 'byDept' | 'byEmployee' | 'byDate' | 'audit' | 'snapshots'>('overview');
  const [historyReports, setHistoryReports] = useState<HistoryReport[]>([]);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<AuditExportSnapshot | null>(null);
  const [restoreCheckResult, setRestoreCheckResult] = useState<RestoreCheckResult | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [forceRestore, setForceRestore] = useState(false);

  const currentBatch = batches.find(b => b.id === currentBatchId);

  useEffect(() => {
    if (currentBatchId) {
      loadAuditLogs(currentBatchId);
      loadExportSnapshots(currentBatchId);
    }
  }, [currentBatchId, loadAuditLogs, loadExportSnapshots]);

  const handleRestoreClick = async (snapshot: AuditExportSnapshot) => {
    setSelectedSnapshot(snapshot);
    setForceRestore(false);
    const checkResult = await checkRestoreConflicts(snapshot.id);
    setRestoreCheckResult(checkResult);
    setShowRestoreModal(true);
  };

  const handleConfirmRestore = async () => {
    if (!selectedSnapshot) return;
    
    setIsRestoring(true);
    try {
      const result = await restoreToSnapshot(selectedSnapshot.id, forceRestore);
      if (result.success) {
        showToast('success', result.message);
        setShowRestoreModal(false);
        setSelectedSnapshot(null);
        setRestoreCheckResult(null);
      } else {
        showToast('error', result.message);
      }
    } catch (error) {
      showToast('error', '恢复失败');
    } finally {
      setIsRestoring(false);
    }
  };

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
    if (!reportData || !currentBatchId) {
      showToast('error', '没有可导出的数据');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    setIsExporting(true);
    
    let snapshotId: string | null = null;
    let exportSuccess = false;
    let errorMessage: string | undefined;

    try {
      const options: ExportOptions = {
        format: exportFormat,
        includeCharts,
        includeCorrections,
        includeAuditSummary,
        title: reportTitle,
        generatedAt: new Date(),
      };

      let content: string | Blob;
      let filename: string;
      const timestamp = new Date().toISOString().slice(0, 10);

      const currentAuditLogs = includeAuditSummary ? auditLogs : [];

      switch (exportFormat) {
        case 'html':
          content = exportModule.generateHTMLReport(reportData, options);
          if (includeAuditSummary && currentAuditLogs.length > 0) {
            const auditSummary = auditModule.generateAuditSummaryHTML(currentAuditLogs, currentBatch?.name || '');
            content = (content as string).replace('</body></html>', auditSummary + '</body></html>');
          }
          filename = `考勤异常报告_${timestamp}.html`;
          break;
        case 'markdown':
          content = exportModule.generateMarkdownReport(reportData, options);
          if (includeAuditSummary && currentAuditLogs.length > 0) {
            const auditSummary = auditModule.generateAuditSummaryMarkdown(currentAuditLogs, currentBatch?.name || '');
            content = (content as string) + '\n\n---\n\n' + auditSummary;
          }
          filename = `考勤异常报告_${timestamp}.md`;
          break;
        case 'excel':
          content = exportModule.generateExcelReport(reportData, options);
          filename = `考勤异常报告_${timestamp}.xlsx`;
          break;
        case 'csv':
          content = exportModule.generateCSVReport(reportData, options);
          if (includeAuditSummary && currentAuditLogs.length > 0) {
            const auditSummary = auditModule.generateAuditSummaryCSV(currentAuditLogs);
            content = (content as string) + '\n\n--- 审计摘要 ---\n' + auditSummary;
          }
          filename = `考勤异常报告_${timestamp}.csv`;
          break;
        default:
          throw new Error('不支持的导出格式');
      }

      const snapshot = await createExportSnapshot(exportFormat, includeAuditSummary);
      snapshotId = snapshot.id;

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

      exportSuccess = true;
      showToast('success', `报告已导出：${filename}`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '导出失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'export',
        description: `导出${exportFormat.toUpperCase()}报告：${reportTitle}${includeAuditSummary ? '（含审计摘要）' : ''}`,
        success: exportSuccess,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          format: exportFormat,
          includeCharts,
          includeCorrections,
          includeAuditSummary,
          title: reportTitle,
        },
        linkedEntityIds: {
          exportId: snapshotId || undefined,
          anomalyIds: anomalies.slice(0, 100).map(a => a.id),
          correctionIds: corrections.slice(0, 100).map(c => c.id),
        },
      });

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
              { key: 'audit', label: '审计时间线', icon: History },
              { key: 'snapshots', label: '导出快照', icon: Clock },
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

            {activeTab === 'audit' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-slate-800 flex items-center gap-2">
                    <History size={18} />
                    审计时间线
                  </h4>
                  <span className="text-sm text-slate-500">
                    共 {auditLogs.length} 条记录
                  </span>
                </div>
                {auditLogs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <Clock size={48} className="mx-auto mb-4 opacity-50" />
                    <p>暂无审计记录</p>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200"></div>
                    {auditLogs.slice(0, 100).map((log, index) => (
                      <div key={log.id} className="relative pl-12 pb-6">
                        <div className={`absolute left-2 w-5 h-5 rounded-full border-2 ${
                          log.success ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                        }`}></div>
                        <div className="bg-slate-50 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                                log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {auditModule.ACTION_LABELS[log.action] || log.action}
                              </span>
                              <span className="ml-2 text-sm text-slate-600">
                                {log.description}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mb-2">
                            操作人: {log.operator} · 统计版本: v{log.statsVersion}
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div>
                              <span className="text-slate-500">异常总数:</span>
                              <span className="ml-1 font-medium">
                                {log.statsBefore.totalAnomalies} → {log.statsAfter.totalAnomalies}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500">待处理:</span>
                              <span className="ml-1 font-medium">
                                {log.statsBefore.pendingAnomalies} → {log.statsAfter.pendingAnomalies}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500">已修正:</span>
                              <span className="ml-1 font-medium">
                                {log.statsBefore.correctedAnomalies} → {log.statsAfter.correctedAnomalies}
                              </span>
                            </div>
                          </div>
                          {log.errorMessage && (
                            <div className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                              <AlertCircle size={12} className="inline mr-1" />
                              {log.errorMessage}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'snapshots' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-slate-800 flex items-center gap-2">
                    <Clock size={18} />
                    导出快照
                  </h4>
                  <span className="text-sm text-slate-500">
                    共 {exportSnapshots.length} 个快照
                  </span>
                </div>
                {exportSnapshots.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <History size={48} className="mx-auto mb-4 opacity-50" />
                    <p>暂无导出快照</p>
                    <p className="text-sm mt-2">导出报告时会自动创建快照，可用于恢复数据</p>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>导出时间</th>
                          <th>格式</th>
                          <th>统计版本</th>
                          <th>异常数</th>
                          <th>修正数</th>
                          <th>审计记录</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exportSnapshots.map((snapshot) => (
                          <tr key={snapshot.id}>
                            <td className="font-medium">
                              {new Date(snapshot.timestamp).toLocaleString()}
                            </td>
                            <td>
                              <span className="badge badge-info">
                                {snapshot.format.toUpperCase()}
                              </span>
                            </td>
                            <td>v{snapshot.statsVersion}</td>
                            <td>{snapshot.batchStats.totalAnomalies}</td>
                            <td>{snapshot.corrections.length}</td>
                            <td>{snapshot.auditLogCount}</td>
                            <td>
                              <button
                                className="btn-sm btn-secondary"
                                onClick={() => handleRestoreClick(snapshot)}
                              >
                                <RotateCcw size={14} className="inline mr-1" />
                                恢复
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAuditSummary}
                    onChange={e => setIncludeAuditSummary(e.target.checked)}
                    className="w-4 h-4 text-[#1e3a5f] rounded"
                  />
                  <span className="text-sm text-slate-700">包含审计摘要</span>
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

      <Modal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        title="确认恢复数据"
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowRestoreModal(false)}>
              <X size={16} className="inline mr-1" />
              取消
            </button>
            <button
              className="btn-primary"
              onClick={handleConfirmRestore}
              disabled={isRestoring || (!restoreCheckResult?.canRestore && !forceRestore)}
            >
              {isRestoring ? (
                <>
                  <Loading size="sm" />
                  <span className="ml-2">恢复中...</span>
                </>
              ) : (
                <>
                  <RotateCcw size={16} className="inline mr-1" />
                  {forceRestore ? '强制恢复' : '确认恢复'}
                </>
              )}
            </button>
          </>
        }
      >
        {selectedSnapshot && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="font-medium text-amber-800">恢复操作不可逆</h5>
                  <p className="text-sm text-amber-700 mt-1">
                    此操作将把当前批次的数据恢复到 {selectedSnapshot.format.toUpperCase()} 报告导出时的状态。
                    当前所有未包含在快照中的异常和修正记录将被删除。
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="text-sm text-slate-500 mb-1">快照信息</div>
                <div className="font-medium">
                  {new Date(selectedSnapshot.timestamp).toLocaleString()}
                </div>
                <div className="text-sm text-slate-600 mt-1">
                  格式: {selectedSnapshot.format.toUpperCase()} · 版本: v{selectedSnapshot.statsVersion}
                </div>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="text-sm text-slate-500 mb-1">快照数据</div>
                <div className="font-medium">
                  {selectedSnapshot.batchStats.totalAnomalies} 条异常
                </div>
                <div className="text-sm text-slate-600 mt-1">
                  {selectedSnapshot.corrections.length} 条修正 · {selectedSnapshot.auditLogCount} 条审计
                </div>
              </div>
            </div>

            {restoreCheckResult && restoreCheckResult.conflicts.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-medium text-red-700 flex items-center gap-2">
                  <AlertCircle size={16} />
                  检测到 {restoreCheckResult.conflicts.length} 个冲突
                </h5>
                <div className="space-y-2">
                  {restoreCheckResult.conflicts.map((conflict, idx) => (
                    <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="text-sm font-medium text-red-800">
                        {conflict.message}
                      </div>
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    checked={forceRestore}
                    onChange={e => setForceRestore(e.target.checked)}
                    className="w-4 h-4 text-red-600 rounded"
                  />
                  <span className="text-sm text-red-700 font-medium">
                    我已了解风险，确认强制恢复（将覆盖当前数据）
                  </span>
                </label>
              </div>
            )}

            {restoreCheckResult && restoreCheckResult.canRestore && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-600" />
                  <span className="text-green-800 font-medium">
                    未检测到冲突，可以安全恢复
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  );
}
