import { useState, useMemo } from 'react';
import {
  Filter,
  Search,
  CheckCircle,
  XCircle,
  Eye,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  User,
  FileText,
  Download,
  PlusCircle,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  Paperclip,
  MessageSquare,
} from 'lucide-react';
import Layout from '@/components/Layout';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import AnomalyBadge from '@/components/AnomalyBadge';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import appealModule, { APPEAL_STATUS_LABELS, APPEAL_STATUS_COLORS } from '@/modules/appeal';
import type { Appeal, AppealStatus, AppealConflict } from '@/types';
import type { CorrectionType } from '@/modules/correction';

interface FilterState {
  status: AppealStatus | '';
  department: string;
  employeeId: string;
  dateRange: { start: string; end: string };
}

const statusLabels: Record<AppealStatus, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'badge-warning' },
  approved: { label: '已通过', className: 'badge-success' },
  rejected: { label: '已驳回', className: 'badge-danger' },
  revoked: { label: '已撤销', className: 'badge-secondary' },
};

export default function AppealsPage() {
  const {
    appeals,
    currentBatchId,
    anomalies,
    createAppeal,
    approveAppeal,
    rejectAppeal,
    revokeAppeal,
    checkAppealConflicts,
    loadAppeals,
    loading,
    getCurrentStatsSnapshot,
    recordAuditLog,
  } = useAppStore();
  const { showToast } = useToast();

  const [showFilters, setShowFilters] = useState(true);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [selectedAppeal, setSelectedAppeal] = useState<Appeal | null>(null);
  const [selectedAnomalyForAppeal, setSelectedAnomalyForAppeal] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeFilter, setActiveFilter] = useState<AppealStatus | ''>('');
  const pageSize = 20;

  const [createForm, setCreateForm] = useState({
    anomalyId: '',
    reason: '',
    correctionType: 'mark_normal' as CorrectionType,
    newStartTime: '',
    newEndTime: '',
    punchIn: '',
    punchOut: '',
    durationMinutes: 0,
    punchTime: '',
    punchType: 'in' as 'in' | 'out',
    evidence: [] as { type: 'file' | 'note' | 'link' | 'leave_record' | 'punch_record'; name: string; description?: string; uploadedBy: string }[],
    noteContent: '',
  });

  const [reviewComment, setReviewComment] = useState('');
  const [conflicts, setConflicts] = useState<AppealConflict[]>([]);

  const [filters, setFilters] = useState<FilterState>({
    status: '',
    department: '',
    employeeId: '',
    dateRange: { start: '', end: '' },
  });

  const pendingAnomalies = useMemo(() => {
    return anomalies.filter(a => a.status === 'pending');
  }, [anomalies]);

  const departments = useMemo(() => {
    const depts = new Set(appeals.map(a => a.department).filter(Boolean));
    return Array.from(depts);
  }, [appeals]);

  const employees = useMemo(() => {
    const emps = new Map<string, string>();
    appeals.forEach(a => {
      emps.set(a.employeeId, a.employeeName || a.employeeId);
    });
    return Array.from(emps.entries());
  }, [appeals]);

  const statusCounts = useMemo(() => {
    const counts: Record<AppealStatus | 'all', number> = {
      all: appeals.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      revoked: 0,
    };
    appeals.forEach(a => {
      counts[a.status] = (counts[a.status] || 0) + 1;
    });
    return counts;
  }, [appeals]);

  const filteredAppeals = useMemo(() => {
    let result = [...appeals];

    if (activeFilter) {
      result = result.filter(a => a.status === activeFilter);
    }

    if (filters.status) {
      result = result.filter(a => a.status === filters.status);
    }
    if (filters.department) {
      result = result.filter(a => a.department === filters.department);
    }
    if (filters.employeeId) {
      result = result.filter(a => a.employeeId === filters.employeeId);
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
          a.reason.toLowerCase().includes(keyword) ||
          a.anomalyDescription.toLowerCase().includes(keyword)
      );
    }

    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === 'scheduleDate') {
        comparison = a.scheduleDate.localeCompare(b.scheduleDate);
      } else if (sortField === 'status') {
        const statusOrder: Record<string, number> = {
          pending: 0,
          approved: 1,
          rejected: 2,
          revoked: 3,
        };
        comparison = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [appeals, filters, searchKeyword, sortField, sortOrder, activeFilter]);

  const paginatedAppeals = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAppeals.slice(start, start + pageSize);
  }, [filteredAppeals, currentPage]);

  const totalPages = Math.ceil(filteredAppeals.length / pageSize);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const resetFilters = () => {
    setFilters({
      status: '',
      department: '',
      employeeId: '',
      dateRange: { start: '', end: '' },
    });
    setSearchKeyword('');
    setActiveFilter('');
    setCurrentPage(1);
  };

  const viewDetail = (appeal: Appeal) => {
    setSelectedAppeal(appeal);
    setShowDetailModal(true);
  };

  const openCreateModal = async () => {
    setCreateForm({
      anomalyId: '',
      reason: '',
      correctionType: 'mark_normal',
      newStartTime: '',
      newEndTime: '',
      punchIn: '',
      punchOut: '',
      durationMinutes: 0,
      punchTime: '',
      punchType: 'in',
      evidence: [],
      noteContent: '',
    });
    setConflicts([]);
    setShowCreateModal(true);
  };

  const handleAnomalySelect = async (anomalyId: string) => {
    setCreateForm(prev => ({ ...prev, anomalyId }));
    if (anomalyId) {
      const foundConflicts = await checkAppealConflicts(anomalyId);
      setConflicts(foundConflicts);
    } else {
      setConflicts([]);
    }
  };

  const addEvidence = () => {
    if (!createForm.noteContent.trim()) return;
    setCreateForm(prev => ({
      ...prev,
      evidence: [...prev.evidence, {
        type: 'note',
        name: '补充说明',
        description: prev.noteContent,
        uploadedBy: 'user',
      }],
      noteContent: '',
    }));
  };

  const removeEvidence = (index: number) => {
    setCreateForm(prev => ({
      ...prev,
      evidence: prev.evidence.filter((_, i) => i !== index),
    }));
  };

  const handleCreate = async () => {
    if (!createForm.anomalyId || !createForm.reason.trim()) {
      showToast('error', '请选择异常并填写申诉原因');
      return;
    }

    if (conflicts.length > 0) {
      showToast('error', conflicts[0].message);
      return;
    }

    let correctionValue: any = {};
    if (createForm.correctionType === 'adjust_time') {
      correctionValue = {
        punchIn: createForm.punchIn,
        punchOut: createForm.punchOut,
        durationMinutes: createForm.durationMinutes,
      };
    } else if (createForm.correctionType === 'add_punch') {
      correctionValue = {
        punchTime: createForm.punchTime,
        punchType: createForm.punchType,
      };
    }

    const result = await createAppeal({
      anomalyId: createForm.anomalyId,
      reason: createForm.reason,
      correctionType: createForm.correctionType,
      correctionValue,
      evidence: createForm.evidence,
    });

    if (result.success) {
      setShowCreateModal(false);
      showToast('success', '申诉提交成功');
      if (currentBatchId) {
        await loadAppeals(currentBatchId);
      }
    } else if (result.conflicts && result.conflicts.length > 0) {
      showToast('error', result.conflicts[0].message);
    } else {
      showToast('error', '申诉提交失败');
    }
  };

  const openApproveModal = (appeal: Appeal) => {
    setSelectedAppeal(appeal);
    setReviewComment('');
    setShowApproveModal(true);
  };

  const handleApprove = async () => {
    if (!selectedAppeal || !reviewComment.trim()) {
      showToast('error', '请填写审批意见');
      return;
    }

    const result = await approveAppeal({
      appealId: selectedAppeal.id,
      comment: reviewComment,
    });

    if (result.success) {
      setShowApproveModal(false);
      showToast('success', '申诉已通过，已自动生成修正记录');
      if (currentBatchId) {
        await loadAppeals(currentBatchId);
      }
    } else if (result.conflicts && result.conflicts.length > 0) {
      showToast('error', result.conflicts[0].message);
    } else {
      showToast('error', '审批失败');
    }
  };

  const openRejectModal = (appeal: Appeal) => {
    setSelectedAppeal(appeal);
    setReviewComment('');
    setShowRejectModal(true);
  };

  const handleReject = async () => {
    if (!selectedAppeal || !reviewComment.trim()) {
      showToast('error', '请填写驳回理由');
      return;
    }

    const result = await rejectAppeal({
      appealId: selectedAppeal.id,
      comment: reviewComment,
    });

    if (result.success) {
      setShowRejectModal(false);
      showToast('success', '申诉已驳回');
      if (currentBatchId) {
        await loadAppeals(currentBatchId);
      }
    } else if (result.conflicts && result.conflicts.length > 0) {
      showToast('error', result.conflicts[0].message);
    } else {
      showToast('error', '驳回失败');
    }
  };

  const openRevokeModal = (appeal: Appeal) => {
    setSelectedAppeal(appeal);
    setShowRevokeModal(true);
  };

  const handleRevoke = async () => {
    if (!selectedAppeal) return;

    const result = await revokeAppeal(selectedAppeal.id);

    if (result.success) {
      setShowRevokeModal(false);
      showToast('success', '申诉已撤销');
      if (currentBatchId) {
        await loadAppeals(currentBatchId);
      }
    } else if (result.conflicts && result.conflicts.length > 0) {
      showToast('error', result.conflicts[0].message);
    } else {
      showToast('error', '撤销失败');
    }
  };

  const handleExportCSV = () => {
    appealModule.downloadAppealCSV(filteredAppeals, `申诉记录_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('success', `已导出 ${filteredAppeals.length} 条申诉记录`);
  };

  const formatDateTime = (date?: Date | string) => {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('zh-CN');
  };

  if (loading && appeals.length === 0) {
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
            <h3 className="text-lg font-semibold text-slate-800">异常申诉</h3>
            <p className="text-sm text-slate-500">
              共 {filteredAppeals.length} 条申诉记录
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              onClick={openCreateModal}
              disabled={pendingAnomalies.length === 0}
            >
              <PlusCircle size={16} className="inline mr-1" />
              发起申诉
            </button>
            <button
              className="btn-secondary"
              onClick={handleExportCSV}
              disabled={filteredAppeals.length === 0}
            >
              <Download size={16} className="inline mr-1" />
              导出 CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {(['all', 'pending', 'approved', 'rejected', 'revoked'] as const).map(status => (
            <button
              key={status}
              className={`p-4 rounded-lg border-2 transition-all text-left ${
                activeFilter === status
                  ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
              onClick={() => {
                setActiveFilter(status === 'all' ? '' : status);
                setCurrentPage(1);
              }}
            >
              <div className="text-2xl font-bold text-slate-800">{statusCounts[status]}</div>
              <div className="text-sm text-slate-500">
                {status === 'all' ? '全部' : statusLabels[status]?.label}
              </div>
            </button>
          ))}
        </div>

        <div className="card">
          <div className="p-4 border-b border-slate-200">
            <div className="flex flex-wrap gap-4">
              <div className="relative flex-1 min-w-64">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  className="input-field pl-10"
                  placeholder="搜索员工姓名、工号、申诉原因或异常描述..."
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
                高级筛选
                {showFilters ? <ChevronUp size={14} className="inline ml-1" /> : <ChevronDown size={14} className="inline ml-1" />}
              </button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-200">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">状态</label>
                  <select
                    className="select-field"
                    value={filters.status}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, status: e.target.value as AppealStatus | '' }));
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    {Object.entries(statusLabels).map(([value, { label }]) => (
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

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">日期范围</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="input-field text-sm flex-1"
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
                      className="input-field text-sm flex-1"
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
                  <th
                    className="cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-1">
                      <Clock size={14} />
                      申诉时间
                      {sortField === 'createdAt' && (
                        sortOrder === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th>员工</th>
                  <th>部门</th>
                  <th
                    className="cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('scheduleDate')}
                  >
                    <div className="flex items-center gap-1">
                      异常日期
                      {sortField === 'scheduleDate' && (
                        sortOrder === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th>异常类型</th>
                  <th>申诉原因</th>
                  <th
                    className="cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1">
                      状态
                      {sortField === 'status' && (
                        sortOrder === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />
                      )}
                    </div>
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAppeals.length > 0 ? (
                  paginatedAppeals.map(appeal => (
                    <tr key={appeal.id}>
                      <td className="whitespace-nowrap text-sm">{formatDateTime(appeal.createdAt)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-slate-400" />
                          <div>
                            <div className="font-medium text-slate-800">
                              {appeal.employeeName || appeal.employeeId}
                            </div>
                            <div className="text-xs text-slate-500">{appeal.employeeId}</div>
                          </div>
                        </div>
                      </td>
                      <td>{appeal.department || '-'}</td>
                      <td className="whitespace-nowrap">{appeal.scheduleDate}</td>
                      <td>
                        <AnomalyBadge type={appeal.anomalyType} />
                      </td>
                      <td className="max-w-xs truncate" title={appeal.reason}>
                        {appeal.reason}
                      </td>
                      <td>
                        <span
                          className={`badge ${statusLabels[appeal.status]?.className}`}
                          style={{ backgroundColor: APPEAL_STATUS_COLORS[appeal.status] + '20', color: APPEAL_COLORS[appeal.status] }}
                        >
                          {statusLabels[appeal.status]?.label}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            className="p-1.5 hover:bg-slate-100 rounded transition-colors"
                            onClick={() => viewDetail(appeal)}
                            title="查看详情"
                          >
                            <Eye size={16} className="text-slate-500" />
                          </button>
                          {appeal.status === 'pending' && (
                            <>
                              <button
                                className="p-1.5 hover:bg-green-50 rounded transition-colors"
                                onClick={() => openApproveModal(appeal)}
                                title="通过"
                              >
                                <ThumbsUp size={16} className="text-green-600" />
                              </button>
                              <button
                                className="p-1.5 hover:bg-red-50 rounded transition-colors"
                                onClick={() => openRejectModal(appeal)}
                                title="驳回"
                              >
                                <ThumbsDown size={16} className="text-red-600" />
                              </button>
                              <button
                                className="p-1.5 hover:bg-orange-50 rounded transition-colors"
                                onClick={() => openRevokeModal(appeal)}
                                title="撤销"
                              >
                                <RotateCcw size={16} className="text-orange-600" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      <FileText size={32} className="mx-auto mb-2" />
                      暂无符合条件的申诉记录
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
                {Math.min(currentPage * pageSize, filteredAppeals.length)} 条，共{' '}
                {filteredAppeals.length} 条
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
        title="申诉详情"
        size="xl"
        footer={
          selectedAppeal?.status === 'pending' ? (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowDetailModal(false);
                  openRevokeModal(selectedAppeal);
                }}
              >
                <RotateCcw size={16} className="inline mr-1" />
                撤销
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowDetailModal(false);
                  openRejectModal(selectedAppeal);
                }}
              >
                <ThumbsDown size={16} className="inline mr-1" />
                驳回
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setShowDetailModal(false);
                  openApproveModal(selectedAppeal);
                }}
              >
                <ThumbsUp size={16} className="inline mr-1" />
                通过
              </button>
            </>
          ) : null
        }
      >
        {selectedAppeal && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className="badge"
                    style={{ backgroundColor: APPEAL_COLORS[selectedAppeal.status] + '20', color: APPEAL_COLORS[selectedAppeal.status] }}
                  >
                    {APPEAL_STATUS_LABELS[selectedAppeal.status]}
                  </span>
                  <AnomalyBadge type={selectedAppeal.anomalyType} />
                </div>
                <p className="text-slate-700 font-medium">{selectedAppeal.reason}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-400" />
                  <span className="text-slate-600">员工：</span>
                  <span className="font-medium">
                    {selectedAppeal.employeeName || selectedAppeal.employeeId}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" />
                  <span className="text-slate-600">工号：</span>
                  <span className="font-medium">{selectedAppeal.employeeId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-slate-600">异常日期：</span>
                  <span className="font-medium">{selectedAppeal.scheduleDate}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-slate-400" />
                  <span className="text-slate-600">发起时间：</span>
                  <span className="font-medium">{formatDateTime(selectedAppeal.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-400" />
                  <span className="text-slate-600">发起人：</span>
                  <span className="font-medium">{selectedAppeal.createdBy}</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg">
              <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                <AlertTriangle size={16} />
                原异常信息
              </h4>
              <p className="text-sm text-slate-700">{selectedAppeal.anomalyDescription}</p>
              {selectedAppeal.correctionType && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <span className="text-sm text-slate-600">申请修正类型：</span>
                  <span className="text-sm font-medium text-[#1e3a5f] ml-2">
                    {selectedAppeal.correctionType}
                  </span>
                </div>
              )}
            </div>

            {selectedAppeal.evidence.length > 0 && (
              <div className="p-4 bg-slate-50 rounded-lg">
                <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <Paperclip size={16} />
                  证明材料 ({selectedAppeal.evidence.length})
                </h4>
                <div className="space-y-2">
                  {selectedAppeal.evidence.map((ev, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {ev.type}
                        </span>
                        <span className="font-medium text-sm">{ev.name}</span>
                      </div>
                      {ev.description && (
                        <p className="text-sm text-slate-600">{ev.description}</p>
                      )}
                      <div className="text-xs text-slate-400 mt-1">
                        上传于 {formatDateTime(ev.uploadedAt)} · {ev.uploadedBy}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedAppeal.reviewComment && (
              <div className="p-4 bg-slate-50 rounded-lg">
                <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
                  <MessageSquare size={16} />
                  审批信息
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">审批人：</span>
                    <span className="font-medium">{selectedAppeal.reviewedBy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">审批时间：</span>
                    <span className="font-medium">{formatDateTime(selectedAppeal.reviewedAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">审批意见：</span>
                    <span className="font-medium">{selectedAppeal.reviewComment}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="发起申诉"
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={conflicts.length > 0}
            >
              提交申诉
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {conflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} />
                存在冲突
              </h4>
              <ul className="text-sm text-red-700 space-y-1">
                {conflicts.map((c, idx) => (
                  <li key={idx}>• {c.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              选择异常 <span className="text-red-500">*</span>
            </label>
            <select
              className="select-field"
              value={createForm.anomalyId}
              onChange={e => handleAnomalySelect(e.target.value)}
            >
              <option value="">请选择要申诉的异常</option>
              {pendingAnomalies.map(anomaly => (
                <option key={anomaly.id} value={anomaly.id}>
                  {anomaly.employeeName || anomaly.employeeId} - {anomaly.scheduleDate} - {anomaly.description.slice(0, 50)}
                </option>
              ))}
            </select>
            {pendingAnomalies.length === 0 && (
              <p className="text-sm text-slate-500 mt-1">暂无待处理的异常可申诉</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              申诉原因 <span className="text-red-500">*</span>
            </label>
            <textarea
              className="input-field min-h-24"
              value={createForm.reason}
              onChange={e => setCreateForm(prev => ({ ...prev, reason: e.target.value }))}
              placeholder="请详细说明申诉原因..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              申请修正类型
            </label>
            <select
              className="select-field"
              value={createForm.correctionType}
              onChange={e =>
                setCreateForm(prev => ({ ...prev, correctionType: e.target.value as CorrectionType }))
              }
            >
              <option value="mark_normal">标记为正常</option>
              <option value="adjust_time">调整时间</option>
              <option value="add_punch">补卡</option>
              <option value="ignore">忽略</option>
              <option value="apply_leave">申请请假</option>
            </select>
          </div>

          {createForm.correctionType === 'adjust_time' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  新上班时间
                </label>
                <input
                  type="time"
                  className="input-field"
                  value={createForm.punchIn}
                  onChange={e =>
                    setCreateForm(prev => ({ ...prev, punchIn: e.target.value }))
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
                  value={createForm.punchOut}
                  onChange={e =>
                    setCreateForm(prev => ({ ...prev, punchOut: e.target.value }))
                  }
                />
              </div>
            </div>
          )}

          {createForm.correctionType === 'add_punch' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  补卡时间
                </label>
                <input
                  type="datetime-local"
                  className="input-field"
                  value={createForm.punchTime}
                  onChange={e =>
                    setCreateForm(prev => ({ ...prev, punchTime: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  打卡类型
                </label>
                <select
                  className="select-field"
                  value={createForm.punchType}
                  onChange={e =>
                    setCreateForm(prev => ({ ...prev, punchType: e.target.value as 'in' | 'out' }))
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
              补充说明
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1"
                value={createForm.noteContent}
                onChange={e =>
                  setCreateForm(prev => ({ ...prev, noteContent: e.target.value }))
                }
                placeholder="添加补充说明..."
              />
              <button className="btn-secondary" onClick={addEvidence}>
                <PlusCircle size={16} className="inline mr-1" />
                添加
              </button>
            </div>
          </div>

          {createForm.evidence.length > 0 && (
            <div className="space-y-2">
              {createForm.evidence.map((ev, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                  <div>
                    <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded mr-2">
                      {ev.type}
                    </span>
                    <span className="text-sm">{ev.name}</span>
                    {ev.description && (
                      <p className="text-xs text-slate-500 mt-1">{ev.description}</p>
                    )}
                  </div>
                  <button
                    className="p-1 hover:bg-red-100 rounded"
                    onClick={() => removeEvidence(idx)}
                  >
                    <XCircle size={16} className="text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showApproveModal}
        onClose={() => setShowApproveModal(false)}
        title="通过申诉"
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowApproveModal(false)}>
              取消
            </button>
            <button className="btn-primary bg-green-600 hover:bg-green-700" onClick={handleApprove}>
              确认通过
            </button>
          </>
        }
      >
        {selectedAppeal && (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700">
                <CheckCircle size={16} className="inline mr-1" />
                通过后将自动根据申诉的修正类型生成对应人工修正记录，异常状态将更新为已修正。
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">员工：</span>
                  <span className="font-medium">
                    {selectedAppeal.employeeName || selectedAppeal.employeeId}
                  </span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">异常日期：</span>
                  <span className="font-medium">{selectedAppeal.scheduleDate}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">申诉原因：</span>
                  <span className="font-medium">{selectedAppeal.reason}</span>
                </div>
                {selectedAppeal.correctionType && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">修正类型：</span>
                    <span className="font-medium">{selectedAppeal.correctionType}</span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                审批意见 <span className="text-red-500">*</span>
              </label>
              <textarea
                className="input-field min-h-20"
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                placeholder="请填写审批意见..."
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="驳回申诉"
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowRejectModal(false)}>
              取消
            </button>
            <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={handleReject}>
              确认驳回
            </button>
          </>
        }
      >
        {selectedAppeal && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-700">
                <AlertTriangle size={16} className="inline mr-1" />
                驳回后申诉状态将更新为已驳回，原异常状态保持不变。
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">员工：</span>
                  <span className="font-medium">
                    {selectedAppeal.employeeName || selectedAppeal.employeeId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">申诉原因：</span>
                  <span className="font-medium">{selectedAppeal.reason}</span>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                驳回理由 <span className="text-red-500">*</span>
              </label>
              <textarea
                className="input-field min-h-20"
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                placeholder="请填写驳回理由..."
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showRevokeModal}
        onClose={() => setShowRevokeModal(false)}
        title="撤销申诉"
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowRevokeModal(false)}>
              取消
            </button>
            <button className="btn-primary bg-orange-600 hover:bg-orange-700" onClick={handleRevoke}>
              确认撤销
            </button>
          </>
        }
      >
        {selectedAppeal && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-700">
                <AlertTriangle size={16} className="inline mr-1" />
                撤销后申诉状态将更新为已撤销，原异常状态保持不变。
              </p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">员工：</span>
                  <span className="font-medium">
                    {selectedAppeal.employeeName || selectedAppeal.employeeId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">申诉原因：</span>
                  <span className="font-medium">{selectedAppeal.reason}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

const APPEAL_COLORS: Record<AppealStatus, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
  revoked: '#6b7280',
};
