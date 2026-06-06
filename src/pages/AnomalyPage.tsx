import { useState, useMemo } from 'react';
import {
  Filter,
  Search,
  CheckCircle,
  XCircle,
  Eye,
  Clock,
  AlertTriangle,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  Clock3,
  MapPin,
  Calendar,
  User,
  Edit3,
  SkipForward,
  ThumbsUp,
  PlusCircle,
  History,
  Undo2,
} from 'lucide-react';
import Layout from '@/components/Layout';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import AnomalyBadge from '@/components/AnomalyBadge';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import correctionModule from '@/modules/correction';
import auditModule from '@/modules/audit';
import type { Anomaly, AnomalyType, Correction } from '@/types';
import type { CorrectionType } from '@/modules/correction';

interface FilterState {
  type: AnomalyType | '';
  severity: string;
  department: string;
  employeeId: string;
  status: string;
  dateRange: { start: string; end: string };
}

const severityLabels: Record<string, { label: string; className: string }> = {
  low: { label: '低', className: 'badge-success' },
  medium: { label: '中', className: 'badge-warning' },
  high: { label: '高', className: 'badge-danger' },
  critical: { label: '严重', className: 'badge-danger' },
};

const statusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'badge-warning' },
  corrected: { label: '已修正', className: 'badge-success' },
  ignored: { label: '已忽略', className: 'badge-secondary' },
  confirmed: { label: '已确认', className: 'badge-info' },
};

export default function AnomalyPage() {
  const {
    anomalies,
    currentBatchId,
    corrections,
    schedules,
    punches,
    updateAnomaly,
    updateAnomalies,
    addCorrection,
    revertCorrection,
    loading,
    recordAuditLog,
    getCurrentStatsSnapshot,
  } = useAppStore();
  const { showToast } = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  const [revertingCorrection, setRevertingCorrection] = useState<Correction | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    type: '',
    severity: '',
    department: '',
    employeeId: '',
    status: '',
    dateRange: { start: '', end: '' },
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [correctionForm, setCorrectionForm] = useState<{
    type: CorrectionType;
    newStartTime: string;
    newEndTime: string;
    punchIn: string;
    punchOut: string;
    durationMinutes: number;
    punchTime: string;
    punchType: 'in' | 'out';
    reason: string;
  }>({
    type: 'adjust_time',
    newStartTime: '',
    newEndTime: '',
    punchIn: '',
    punchOut: '',
    durationMinutes: 0,
    punchTime: '',
    punchType: 'in',
    reason: '',
  });
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const departments = useMemo(() => {
    const depts = new Set(anomalies.map(a => a.department).filter(Boolean));
    return Array.from(depts);
  }, [anomalies]);

  const employees = useMemo(() => {
    const emps = new Map<string, string>();
    anomalies.forEach(a => {
      emps.set(a.employeeId, a.employeeName || a.employeeId);
    });
    return Array.from(emps.entries());
  }, [anomalies]);

  const filteredAnomalies = useMemo(() => {
    let result = [...anomalies];

    if (filters.type) {
      result = result.filter(a => a.type === filters.type);
    }
    if (filters.severity) {
      result = result.filter(a => a.severity === filters.severity);
    }
    if (filters.department) {
      result = result.filter(a => a.department === filters.department);
    }
    if (filters.employeeId) {
      result = result.filter(a => a.employeeId === filters.employeeId);
    }
    if (filters.status) {
      result = result.filter(a => a.status === filters.status);
    }
    if (filters.dateRange.start) {
      result = result.filter(a => a.scheduleDate >= filters.dateRange.start);
    }
    if (filters.dateRange.end) {
      result = result.filter(a => a.scheduleDate <= filters.dateRange.end);
    }
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      result = result.filter(
        a =>
          a.employeeName?.toLowerCase().includes(keyword) ||
          a.employeeId.toLowerCase().includes(keyword) ||
          a.description.toLowerCase().includes(keyword)
      );
    }

    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'createdAt') {
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === 'scheduleDate') {
        comparison = a.scheduleDate.localeCompare(b.scheduleDate);
      } else if (sortField === 'severity') {
        const severityOrder: Record<string, number> = {
          critical: 4,
          high: 3,
          medium: 2,
          low: 1,
        };
        comparison = (severityOrder[a.severity] || 0) - (severityOrder[b.severity] || 0);
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [anomalies, filters, searchKeyword, sortField, sortOrder]);

  const paginatedAnomalies = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAnomalies.slice(start, start + pageSize);
  }, [filteredAnomalies, currentPage]);

  const totalPages = Math.ceil(filteredAnomalies.length / pageSize);

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedAnomalies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedAnomalies.map(a => a.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const viewDetail = (anomaly: Anomaly) => {
    setSelectedAnomaly(anomaly);
    setShowDetailModal(true);
  };

  const openCorrectionModal = (anomaly: Anomaly) => {
    setSelectedAnomaly(anomaly);
    setCorrectionForm({
      type: 'adjust_time',
      newStartTime: anomaly.scheduledStart || '',
      newEndTime: anomaly.scheduledEnd || '',
      punchIn: '',
      punchOut: '',
      durationMinutes: anomaly.durationMinutes || 0,
      punchTime: '',
      punchType: 'in',
      reason: '',
    });
    setShowCorrectionModal(true);
  };

  const handleCorrect = async () => {
    if (!selectedAnomaly || !correctionForm.reason.trim() || !currentBatchId) {
      showToast('error', '请填写修正原因');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;

    try {
      let newValue: any = {};
      if (correctionForm.type === 'adjust_time') {
        newValue = {
          punchIn: correctionForm.punchIn,
          punchOut: correctionForm.punchOut,
          durationMinutes: correctionForm.durationMinutes,
        };
      } else if (correctionForm.type === 'add_punch') {
        newValue = {
          punchTime: correctionForm.punchTime,
          punchType: correctionForm.punchType,
        };
      }

      const result = await correctionModule.correctAnomaly(
        selectedAnomaly.id,
        correctionForm.type,
        newValue,
        correctionForm.reason
      );

      if (result.success && result.updatedAnomaly && result.correction) {
        await updateAnomaly(result.updatedAnomaly);
        await addCorrection(result.correction);
        setShowCorrectionModal(false);
        showToast('success', '异常修正成功');
        success = true;
      } else {
        showToast('error', '修正失败');
        errorMessage = '修正失败';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '修正失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'correction',
        description: `修正异常：${correctionModule.CORRECTION_TYPE_LABELS[correctionForm.type]}，原因：${correctionForm.reason}`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          correctionType: correctionForm.type,
          reason: correctionForm.reason,
        },
        linkedEntityIds: {
          anomalyIds: [selectedAnomaly.id],
        },
      });
    }
  };

  const handleIgnore = async (anomaly: Anomaly) => {
    if (!currentBatchId) return;

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;

    try {
      const result = await correctionModule.ignoreAnomaly(anomaly.id, '用户手动标记忽略');
      if (result.success && result.updatedAnomaly) {
        await updateAnomaly(result.updatedAnomaly);
        await addCorrection(result.correction);
        showToast('success', '已标记为忽略');
        success = true;
      } else {
        showToast('error', '操作失败');
        errorMessage = '操作失败';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '操作失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'correction',
        description: '标记异常为忽略，原因：用户手动标记忽略',
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          correctionType: 'ignore',
          reason: '用户手动标记忽略',
        },
        linkedEntityIds: {
          anomalyIds: [anomaly.id],
        },
      });
    }
  };

  const handleConfirm = async (anomaly: Anomaly) => {
    if (!currentBatchId) return;

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;

    try {
      const result = await correctionModule.confirmAnomaly(anomaly.id);
      if (result.success && result.updatedAnomaly) {
        await updateAnomaly(result.updatedAnomaly);
        await addCorrection(result.correction);
        showToast('success', '已确认异常');
        success = true;
      } else {
        showToast('error', '操作失败');
        errorMessage = '操作失败';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '操作失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'correction',
        description: '确认异常真实存在',
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          correctionType: 'confirm',
        },
        linkedEntityIds: {
          anomalyIds: [anomaly.id],
        },
      });
    }
  };

  const openRevertModal = (anomaly: Anomaly) => {
    const correction = corrections.find(c => c.id === anomaly.correctionId);
    if (!correction) return;
    setSelectedAnomaly(anomaly);
    setRevertingCorrection(correction);
    setShowRevertModal(true);
  };

  const handleRevert = async () => {
    if (!revertingCorrection || !currentBatchId) return;

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;

    try {
      const result = await revertCorrection(revertingCorrection.id);
      if (result) {
        setShowRevertModal(false);
        setRevertingCorrection(null);
        setSelectedAnomaly(null);
        showToast('success', '撤回成功，异常已恢复到修正前状态');
        success = true;
      } else {
        showToast('error', '撤回失败');
        errorMessage = '撤回失败';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '撤回失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'revert_correction',
        description: `撤回修正，原因：${revertingCorrection.reason}`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          correctionId: revertingCorrection.id,
          correctionType: revertingCorrection.type,
        },
        linkedEntityIds: {
          anomalyIds: [revertingCorrection.anomalyId],
          correctionIds: [revertingCorrection.id],
        },
      });
    }
  };

  const handleBatchCorrect = async () => {
    if (selectedIds.size === 0 || !currentBatchId) {
      showToast('warning', '请先选择要处理的异常');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;
    const anomalyIds = Array.from(selectedIds);
    let updatedCount = 0;

    try {
      const results = await correctionModule.batchCorrect(
        anomalyIds,
        'mark_normal',
        {},
        '批量标记为正常'
      );

      const updatedAnomalies: Anomaly[] = [];
      const newCorrections: Correction[] = [];

      for (const result of results) {
        if (result.success && result.updatedAnomaly && result.correction) {
          updatedAnomalies.push(result.updatedAnomaly);
          newCorrections.push(result.correction);
        }
      }

      if (updatedAnomalies.length > 0) {
        await updateAnomalies(updatedAnomalies);
        for (const correction of newCorrections) {
          await addCorrection(correction);
        }
        updatedCount = updatedAnomalies.length;
        success = true;
      }

      setSelectedIds(new Set());
      showToast('success', `批量修正 ${updatedAnomalies.length} 条异常`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '批量操作失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'correction',
        description: `批量修正 ${updatedCount} 条异常为正常，原因：批量标记为正常`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          correctionType: 'mark_normal',
          reason: '批量标记为正常',
          totalCount: anomalyIds.length,
          successCount: updatedCount,
        },
        linkedEntityIds: {
          anomalyIds,
        },
      });
    }
  };

  const handleBatchIgnore = async () => {
    if (selectedIds.size === 0 || !currentBatchId) {
      showToast('warning', '请先选择要处理的异常');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;
    const anomalyIds = Array.from(selectedIds);
    let updatedCount = 0;

    try {
      const results = await correctionModule.batchCorrect(
        anomalyIds,
        'ignore',
        {},
        '批量忽略'
      );

      const updatedAnomalies: Anomaly[] = [];
      const newCorrections: Correction[] = [];

      for (const result of results) {
        if (result.success && result.updatedAnomaly && result.correction) {
          updatedAnomalies.push(result.updatedAnomaly);
          newCorrections.push(result.correction);
        }
      }

      if (updatedAnomalies.length > 0) {
        await updateAnomalies(updatedAnomalies);
        for (const correction of newCorrections) {
          await addCorrection(correction);
        }
        updatedCount = updatedAnomalies.length;
        success = true;
      }

      setSelectedIds(new Set());
      showToast('success', `批量忽略 ${updatedAnomalies.length} 条异常`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '批量操作失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'correction',
        description: `批量忽略 ${updatedCount} 条异常，原因：批量忽略`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          correctionType: 'ignore',
          reason: '批量忽略',
          totalCount: anomalyIds.length,
          successCount: updatedCount,
        },
        linkedEntityIds: {
          anomalyIds,
        },
      });
    }
  };

  const resetFilters = () => {
    setFilters({
      type: '',
      severity: '',
      department: '',
      employeeId: '',
      status: '',
      dateRange: { start: '', end: '' },
    });
    setSearchKeyword('');
    setCurrentPage(1);
  };

  const getAnomalyCorrections = (anomalyId: string): Correction[] => {
    return corrections.filter(c => c.anomalyId === anomalyId);
  };

  const getAnomalySchedule = (anomaly: Anomaly) => {
    return schedules.find(
      s => s.employeeId === anomaly.employeeId && s.scheduleDate === anomaly.scheduleDate
    );
  };

  const getAnomalyPunches = (anomaly: Anomaly) => {
    const schedule = getAnomalySchedule(anomaly);
    if (!schedule) return [];

    const scheduleDate = new Date(anomaly.scheduleDate);
    const nextDate = new Date(scheduleDate);
    nextDate.setDate(nextDate.getDate() + 2);

    return punches.filter(p => {
      if (p.employeeId !== anomaly.employeeId) return false;
      const punchDate = new Date(p.punchTime);
      return punchDate >= scheduleDate && punchDate <= nextDate;
    });
  };

  const formatTime = (date?: Date | string) => {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateTime = (date?: Date | string) => {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('zh-CN');
  };

  if (loading && anomalies.length === 0) {
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
          <p className="text-slate-500">前往数据导入页面创建或选择批次</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">异常分析</h3>
            <p className="text-sm text-slate-500">
              共 {filteredAnomalies.length} 条异常记录
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              onClick={handleBatchCorrect}
              disabled={selectedIds.size === 0}
            >
              <CheckCircle size={16} className="inline mr-1" />
              批量修正 ({selectedIds.size})
            </button>
            <button
              className="btn-secondary"
              onClick={handleBatchIgnore}
              disabled={selectedIds.size === 0}
            >
              <SkipForward size={16} className="inline mr-1" />
              批量忽略 ({selectedIds.size})
            </button>
          </div>
        </div>

        <div className="card">
          <div className="p-4 border-b border-slate-200">
            <div className="flex flex-wrap gap-4">
              <div className="relative flex-1 min-w-64">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  className="input-field pl-10"
                  placeholder="搜索员工姓名、工号或异常描述..."
                  value={searchKeyword}
                  onChange={e => {
                    setSearchKeyword(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>
              <button
                className="btn-secondary"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter size={16} className="inline mr-1" />
                筛选
                {showFilters ? <ChevronUp size={14} className="inline ml-1" /> : <ChevronDown size={14} className="inline ml-1" />}
              </button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-4 pt-4 border-t border-slate-200">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">异常类型</label>
                  <select
                    className="select-field"
                    value={filters.type}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, type: e.target.value as AnomalyType | '' }));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    {Object.entries({
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
                    }).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">严重程度</label>
                  <select
                    className="select-field"
                    value={filters.severity}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, severity: e.target.value }));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    {Object.entries(severityLabels).map(([value, { label }]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">部门</label>
                  <select
                    className="select-field"
                    value={filters.department}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, department: e.target.value }));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    {departments.map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">员工</label>
                  <select
                    className="select-field"
                    value={filters.employeeId}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, employeeId: e.target.value }));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    {employees.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">状态</label>
                  <select
                    className="select-field"
                    value={filters.status}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, status: e.target.value }));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    {Object.entries(statusLabels).map(([value, { label }]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">日期范围</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="input-field text-sm"
                      value={filters.dateRange.start}
                      onChange={e => {
                        setFilters(prev => ({
                          ...prev,
                          dateRange: { ...prev.dateRange, start: e.target.value },
                        }));
                        setCurrentPage(1);
                      }}
                    />
                    <input
                      type="date"
                      className="input-field text-sm"
                      value={filters.dateRange.end}
                      onChange={e => {
                        setFilters(prev => ({
                          ...prev,
                          dateRange: { ...prev.dateRange, end: e.target.value },
                        }));
                        setCurrentPage(1);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {showFilters && (
              <div className="flex justify-end mt-4">
                <button className="text-sm text-[#1e3a5f] hover:underline" onClick={resetFilters}>
                  重置筛选
                </button>
              </div>
            )}
          </div>

          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-12">
                    <button onClick={toggleSelectAll}>
                      {selectedIds.size === paginatedAnomalies.length && paginatedAnomalies.length > 0 ? (
                        <CheckSquare size={18} className="text-[#1e3a5f]" />
                      ) : (
                        <Square size={18} className="text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th
                    className="cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('scheduleDate')}
                  >
                    <div className="flex items-center gap-1">
                      <Calendar size={14} />
                      日期
                      {sortField === 'scheduleDate' && (
                        sortOrder === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th>员工</th>
                  <th>部门</th>
                  <th>异常类型</th>
                  <th
                    className="cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('severity')}
                  >
                    <div className="flex items-center gap-1">
                      严重程度
                      {sortField === 'severity' && (
                        sortOrder === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th>异常时长</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAnomalies.length > 0 ? (
                  paginatedAnomalies.map(anomaly => (
                    <tr key={anomaly.id}>
                      <td>
                        <button onClick={() => toggleSelect(anomaly.id)}>
                          {selectedIds.has(anomaly.id) ? (
                            <CheckSquare size={18} className="text-[#1e3a5f]" />
                          ) : (
                            <Square size={18} className="text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap">{anomaly.scheduleDate}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-slate-400" />
                          <div>
                            <div className="font-medium text-slate-800">
                              {anomaly.employeeName || anomaly.employeeId}
                            </div>
                            <div className="text-xs text-slate-500">{anomaly.employeeId}</div>
                          </div>
                        </div>
                      </td>
                      <td>{anomaly.department || '-'}</td>
                      <td>
                        <AnomalyBadge type={anomaly.type} />
                      </td>
                      <td>
                        <span className={`badge ${severityLabels[anomaly.severity]?.className}`}>
                          {severityLabels[anomaly.severity]?.label}
                        </span>
                      </td>
                      <td>
                        {anomaly.durationMinutes
                          ? `${Math.floor(anomaly.durationMinutes / 60)}时${anomaly.durationMinutes % 60}分`
                          : '-'}
                      </td>
                      <td>
                        <span className={`badge ${statusLabels[anomaly.status]?.className}`}>
                          {statusLabels[anomaly.status]?.label}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            className="p-1.5 hover:bg-slate-100 rounded transition-colors"
                            onClick={() => viewDetail(anomaly)}
                            title="查看详情"
                          >
                            <Eye size={16} className="text-slate-500" />
                          </button>
                          {anomaly.status === 'pending' && (
                            <>
                              <button
                                className="p-1.5 hover:bg-green-50 rounded transition-colors"
                                onClick={() => openCorrectionModal(anomaly)}
                                title="修正"
                              >
                                <Edit3 size={16} className="text-green-600" />
                              </button>
                              <button
                                className="p-1.5 hover:bg-blue-50 rounded transition-colors"
                                onClick={() => handleConfirm(anomaly)}
                                title="确认异常"
                              >
                                <ThumbsUp size={16} className="text-blue-600" />
                              </button>
                              <button
                                className="p-1.5 hover:bg-slate-100 rounded transition-colors"
                                onClick={() => handleIgnore(anomaly)}
                                title="忽略"
                              >
                                <SkipForward size={16} className="text-slate-500" />
                              </button>
                            </>
                          )}
                          {anomaly.status !== 'pending' && anomaly.correctionId && (
                            <button
                              className="p-1.5 hover:bg-orange-50 rounded transition-colors"
                              onClick={() => openRevertModal(anomaly)}
                              title="撤回修正"
                            >
                              <Undo2 size={16} className="text-orange-600" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-400">
                      <AlertTriangle size={32} className="mx-auto mb-2" />
                      暂无符合条件的异常记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <div className="text-sm text-slate-500">
                显示 {(currentPage - 1) * pageSize + 1} -{' '}
                {Math.min(currentPage * pageSize, filteredAnomalies.length)} 条，共{' '}
                {filteredAnomalies.length} 条
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-secondary text-sm py-1 px-3"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                >
                  上一页
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let page;
                  if (totalPages <= 5) {
                    page = i + 1;
                  } else if (currentPage <= 3) {
                    page = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    page = totalPages - 4 + i;
                  } else {
                    page = currentPage - 2 + i;
                  }
                  return (
                    <button
                      key={page}
                      className={`px-3 py-1 rounded text-sm ${
                        currentPage === page
                          ? 'bg-[#1e3a5f] text-white'
                          : 'hover:bg-slate-100 text-slate-700'
                      }`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  );
                })}
                <button
                  className="btn-secondary text-sm py-1 px-3"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="异常详情"
        size="xl"
        footer={
          selectedAnomaly?.status === 'pending' ? (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowDetailModal(false);
                  handleIgnore(selectedAnomaly);
                }}
              >
                忽略
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowDetailModal(false);
                  handleConfirm(selectedAnomaly);
                }}
              >
                确认异常
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setShowDetailModal(false);
                  openCorrectionModal(selectedAnomaly);
                }}
              >
                修正
              </button>
            </>
          ) : selectedAnomaly?.correctionId ? (
            <button
              className="btn-secondary"
              onClick={() => {
                setShowDetailModal(false);
                openRevertModal(selectedAnomaly);
              }}
            >
              <Undo2 size={16} className="inline mr-1" />
              撤回修正
            </button>
          ) : null
        }
      >
        {selectedAnomaly && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AnomalyBadge type={selectedAnomaly.type} />
                  <span className={`badge ${severityLabels[selectedAnomaly.severity]?.className}`}>
                    {severityLabels[selectedAnomaly.severity]?.label}
                  </span>
                  <span className={`badge ${statusLabels[selectedAnomaly.status]?.className}`}>
                    {statusLabels[selectedAnomaly.status]?.label}
                  </span>
                </div>
                <p className="text-slate-700">{selectedAnomaly.description}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-400" />
                  <span className="text-slate-600">员工：</span>
                  <span className="font-medium">
                    {selectedAnomaly.employeeName || selectedAnomaly.employeeId}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-slate-400" />
                  <span className="text-slate-600">部门：</span>
                  <span className="font-medium">{selectedAnomaly.department || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  <span className="text-slate-600">日期：</span>
                  <span className="font-medium">{selectedAnomaly.scheduleDate}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 size={14} className="text-slate-400" />
                  <span className="text-slate-600">异常时长：</span>
                  <span className="font-medium">
                    {selectedAnomaly.durationMinutes
                      ? `${Math.floor(selectedAnomaly.durationMinutes / 60)}时${selectedAnomaly.durationMinutes % 60}分`
                      : '-'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <Clock size={16} />
                  排班信息
                </h4>
                {getAnomalySchedule(selectedAnomaly) ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">上班时间</span>
                      <span className="font-medium">{selectedAnomaly.scheduledStart || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">下班时间</span>
                      <span className="font-medium">{selectedAnomaly.scheduledEnd || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">班次类型</span>
                      <span className="font-medium">
                        {getAnomalySchedule(selectedAnomaly)?.shiftType === 'crossDay'
                          ? '跨日班次'
                          : getAnomalySchedule(selectedAnomaly)?.shiftType === 'night'
                          ? '夜班'
                          : '正常班次'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">暂无排班信息</p>
                )}
              </div>

              <div className="p-4 bg-slate-50 rounded-lg">
                <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <Clock3 size={16} />
                  打卡记录
                </h4>
                {getAnomalyPunches(selectedAnomaly).length > 0 ? (
                  <div className="space-y-2 text-sm max-h-32 overflow-y-auto">
                    {getAnomalyPunches(selectedAnomaly).map(punch => (
                      <div key={punch.id} className="flex justify-between items-center">
                        <span className="text-slate-600">
                          {punch.punchType === 'in' ? '上班卡' : punch.punchType === 'out' ? '下班卡' : '自动识别'}
                        </span>
                        <span className="font-medium">{formatDateTime(punch.punchTime)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">暂无打卡记录</p>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg">
              <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                <History size={16} />
                修正历史
              </h4>
              {getAnomalyCorrections(selectedAnomaly.id).length > 0 ? (
                <div className="space-y-3">
                  {getAnomalyCorrections(selectedAnomaly.id).map(correction => (
                    <div
                      key={correction.id}
                      className="p-3 bg-white rounded-lg border border-slate-200"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-800">
                          {correction.type === 'adjust_time'
                            ? '调整时间'
                            : correction.type === 'mark_normal'
                            ? '标记正常'
                            : correction.type === 'supplement_punch'
                            ? '补卡'
                            : correction.type}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDateTime(correction.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 space-y-1">
                        <div>原值：{correction.oldValue}</div>
                        <div>新值：{correction.newValue}</div>
                        <div>原因：{correction.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">暂无修正记录</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
        title="修正异常"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowCorrectionModal(false)}>
              取消
            </button>
            <button className="btn-primary" onClick={handleCorrect}>
              确认修正
            </button>
          </>
        }
      >
        {selectedAnomaly && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AnomalyBadge type={selectedAnomaly.type} />
                <span className="text-sm text-slate-600">
                  {selectedAnomaly.employeeName || selectedAnomaly.employeeId} -{' '}
                  {selectedAnomaly.scheduleDate}
                </span>
              </div>
              <p className="text-sm text-slate-700">{selectedAnomaly.description}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">修正类型</label>
              <select
                className="select-field"
                value={correctionForm.type}
                onChange={e =>
                  setCorrectionForm(prev => ({ ...prev, type: e.target.value as CorrectionType }))
                }
              >
                <option value="adjust_time">调整时间</option>
                <option value="mark_normal">标记正常</option>
                <option value="add_punch">补卡</option>
                <option value="ignore">忽略</option>
                <option value="confirm">确认异常</option>
              </select>
            </div>

            {correctionForm.type === 'adjust_time' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    新上班时间
                  </label>
                  <input
                    type="time"
                    className="input-field"
                    value={correctionForm.newStartTime}
                    onChange={e =>
                      setCorrectionForm(prev => ({ ...prev, newStartTime: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    新下班时间
                  </label>
                  <input
                    type="time"
                    className="input-field"
                    value={correctionForm.newEndTime}
                    onChange={e =>
                      setCorrectionForm(prev => ({ ...prev, newEndTime: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            {correctionForm.type === 'add_punch' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    补卡时间
                  </label>
                  <input
                    type="datetime-local"
                    className="input-field"
                    onChange={e =>
                      setCorrectionForm(prev => ({ ...prev, newStartTime: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    打卡类型
                  </label>
                  <select
                    className="select-field"
                    onChange={e =>
                      setCorrectionForm(prev => ({ ...prev, newEndTime: e.target.value }))
                    }
                  >
                    <option value="in">上班卡</option>
                    <option value="out">下班卡</option>
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                修正原因 <span className="text-red-500">*</span>
              </label>
              <textarea
                className="input-field min-h-24"
                value={correctionForm.reason}
                onChange={e =>
                  setCorrectionForm(prev => ({ ...prev, reason: e.target.value }))
                }
                placeholder="请详细说明修正原因..."
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showRevertModal}
        onClose={() => {
          setShowRevertModal(false);
          setRevertingCorrection(null);
        }}
        title="确认撤回修正"
        size="md"
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => {
                setShowRevertModal(false);
                setRevertingCorrection(null);
              }}
            >
              取消
            </button>
            <button className="btn-primary bg-orange-600 hover:bg-orange-700" onClick={handleRevert}>
              确认撤回
            </button>
          </>
        }
      >
        {revertingCorrection && selectedAnomaly && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-amber-800 mb-1">撤回后将恢复到修正前状态</h4>
                  <p className="text-sm text-amber-700">
                    异常状态、描述、时长等所有字段将恢复到修正之前的值，此操作不会删除修正历史记录。
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">员工：</span>
                <span className="font-medium">{selectedAnomaly.employeeName || selectedAnomaly.employeeId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">日期：</span>
                <span className="font-medium">{selectedAnomaly.scheduleDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">异常类型：</span>
                <AnomalyBadge type={selectedAnomaly.type} />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">修正类型：</span>
                <span className="font-medium">
                  {correctionModule.CORRECTION_TYPE_LABELS[revertingCorrection.type as CorrectionType] || revertingCorrection.type}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">修正时间：</span>
                <span className="font-medium">{formatDateTime(revertingCorrection.createdAt)}</span>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <div className="text-slate-600 mb-1">修正原因：</div>
                <div className="font-medium bg-slate-50 p-2 rounded">{revertingCorrection.reason}</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
