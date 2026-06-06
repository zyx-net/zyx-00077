import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  Play,
  Save,
  Download,
  Upload,
  RotateCcw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Users,
  GitCompare,
  Copy,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  X,
  FileJson,
  History,
  Shield,
  ShieldOff,
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
  Search,
  Filter,
  Database,
} from 'lucide-react';
import Layout from '@/components/Layout';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import StatCard from '@/components/StatCard';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import { DEFAULT_PARAMS } from '@/modules/simulator';
import type {
  Simulator,
  SimulatorConflict,
  SimulatorRuleParams,
  Anomaly,
  SimulationDiffItem,
  AnomalyType,
} from '@/types';

type ViewMode = 'list' | 'detail' | 'edit';
type DiffFilter = 'all' | 'added' | 'removed' | 'modified';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-600' },
  ready: { label: '已就绪', className: 'bg-blue-100 text-blue-600' },
  applied: { label: '已应用', className: 'bg-green-100 text-green-600' },
  reverted: { label: '已撤销', className: 'bg-orange-100 text-orange-600' },
  conflicted: { label: '有冲突', className: 'bg-red-100 text-red-600' },
};

const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  late: '迟到',
  early_leave: '早退',
  missing_punch: '缺打卡',
  missing_punch_in: '缺上班打卡',
  missing_punch_out: '缺下班打卡',
  cross_day: '跨日班次',
  duplicate: '重复打卡',
  leave_offset: '调休偏差',
  overtime: '加班异常',
  timezone_error: '时区错误',
  no_schedule: '无排班',
  no_punch: '无打卡记录',
};

export default function SimulatorPage() {
  const {
    currentBatchId,
    batches,
    simulators,
    currentSimulatorId,
    loading,
    loadSimulators,
    selectSimulator,
    createSimulator,
    updateSimulator,
    runSimulation,
    duplicateSimulator,
    deleteSimulator,
    saveSimulatorDraft,
    applySimulator,
    revertSimulator,
    checkSimulatorConflicts,
    checkSimulatorPermission,
    exportSimulatorsToJSON,
    importSimulatorsFromJSON,
    forceImportSimulator,
  } = useAppStore();

  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentUser] = useState('admin_user');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showImportResultModal, setShowImportResultModal] = useState(false);

  const [newSimName, setNewSimName] = useState('');
  const [newSimDesc, setNewSimDesc] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const [editParams, setEditParams] = useState<SimulatorRuleParams>({ ...DEFAULT_PARAMS });
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [conflicts, setConflicts] = useState<SimulatorConflict[]>([]);
  const [pendingAction, setPendingAction] = useState<{
    type: 'apply' | 'save' | 'delete';
    simulatorId?: string;
    overwrite?: boolean;
  } | null>(null);

  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());

  const [importResult, setImportResult] = useState<{
    imported: Simulator[];
    skipped: Array<{ data: any; reason: string }>;
    conflicts: SimulatorConflict[];
  } | null>(null);

  const currentSimulator = useMemo(() => {
    return simulators.find(s => s.id === currentSimulatorId);
  }, [simulators, currentSimulatorId]);

  const filteredSimulators = useMemo(() => {
    if (!currentBatchId) return simulators;
    return simulators.filter(s => s.sourceBatchId === currentBatchId);
  }, [simulators, currentBatchId]);

  const filteredDiffItems = useMemo(() => {
    if (!currentSimulator?.simulationDiff) return [];
    let items = currentSimulator.simulationDiff.items;

    if (diffFilter !== 'all') {
      items = items.filter(item => item.type === diffFilter);
    }

    if (searchText) {
      const search = searchText.toLowerCase();
      items = items.filter(item => {
        const anomaly = item.simulated || item.original;
        if (!anomaly) return false;
        return (
          anomaly.employeeName?.toLowerCase().includes(search) ||
          anomaly.employeeId.toLowerCase().includes(search) ||
          anomaly.description.toLowerCase().includes(search)
        );
      });
    }

    return items;
  }, [currentSimulator?.simulationDiff, diffFilter, searchText]);

  const employeeGroupedDiff = useMemo(() => {
    const groups: Record<string, SimulationDiffItem[]> = {};
    filteredDiffItems.forEach(item => {
      const anomaly = item.simulated || item.original;
      if (!anomaly) return;
      const key = anomaly.employeeId;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });
    return groups;
  }, [filteredDiffItems]);

  const canEdit = useMemo(() => {
    if (!currentSimulator) return false;
    return checkSimulatorPermission(currentSimulator, currentUser, 'admin');
  }, [currentSimulator, currentUser, checkSimulatorPermission]);

  const canView = useMemo(() => {
    if (!currentSimulator) return false;
    return checkSimulatorPermission(currentSimulator, currentUser, 'readonly');
  }, [currentSimulator, currentUser, checkSimulatorPermission]);

  useEffect(() => {
    loadSimulators();
  }, [loadSimulators]);

  useEffect(() => {
    if (currentBatchId) {
      setSelectedBatchId(currentBatchId);
    }
  }, [currentBatchId]);

  useEffect(() => {
    if (currentSimulator && viewMode === 'edit') {
      setEditParams({ ...currentSimulator.params });
      setEditName(currentSimulator.name);
      setEditDesc(currentSimulator.description || '');
      setHasUnsavedChanges(false);
    }
  }, [currentSimulator, viewMode]);

  const handleCreateSimulator = async () => {
    if (!newSimName.trim()) {
      showToast('error', '请输入方案名称');
      return;
    }
    if (!selectedBatchId) {
      showToast('error', '请选择批次');
      return;
    }

    const result = await createSimulator({
      name: newSimName.trim(),
      description: newSimDesc.trim(),
      sourceBatchId: selectedBatchId,
      operator: currentUser,
    });

    if (result.success && result.simulator) {
      showToast('success', '创建成功');
      setShowCreateModal(false);
      setNewSimName('');
      setNewSimDesc('');
      selectSimulator(result.simulator.id);
      setViewMode('edit');
    } else if (result.conflicts && result.conflicts.length > 0) {
      setConflicts(result.conflicts);
      setShowConflictModal(true);
    } else {
      showToast('error', '创建失败');
    }
  };

  const handleParamChange = (key: keyof SimulatorRuleParams, value: number) => {
    setEditParams(prev => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
  };

  const handleSaveDraft = async (overwrite: boolean = false) => {
    if (!currentSimulator) return;

    const updated: Simulator = {
      ...currentSimulator,
      name: editName.trim() || currentSimulator.name,
      description: editDesc.trim(),
      params: editParams,
    };

    const result = await saveSimulatorDraft(updated, overwrite, currentUser);

    if (result.success && result.simulator) {
      showToast('success', '保存成功');
      setHasUnsavedChanges(false);
      await loadSimulators();
    } else if (result.conflicts && result.conflicts.length > 0) {
      setConflicts(result.conflicts);
      setPendingAction({ type: 'save', simulatorId: currentSimulator.id, overwrite });
      setShowConflictModal(true);
    } else {
      showToast('error', '保存失败');
    }
  };

  const handleRunSimulation = async () => {
    if (!currentSimulator) return;

    if (hasUnsavedChanges) {
      const saveResult = await saveSimulatorDraft(
        {
          ...currentSimulator,
          name: editName.trim() || currentSimulator.name,
          description: editDesc.trim(),
          params: editParams,
        },
        false,
        currentUser
      );
      if (!saveResult.success) {
        if (saveResult.conflicts && saveResult.conflicts.length > 0) {
          setConflicts(saveResult.conflicts);
          setPendingAction({ type: 'save', simulatorId: currentSimulator.id });
          setShowConflictModal(true);
        }
        return;
      }
      setHasUnsavedChanges(false);
    }

    const detectedConflicts = await checkSimulatorConflicts(currentSimulator.id);
    const errors = detectedConflicts.filter(c => c.severity === 'error');

    if (errors.length > 0) {
      setConflicts(detectedConflicts);
      setPendingAction({ type: 'apply', simulatorId: currentSimulator.id });
      setShowConflictModal(true);
      return;
    }

    const result = await runSimulation(currentSimulator.id);
    if (result) {
      showToast('success', `模拟完成，耗时 ${result.result.durationMs}ms`);
      setViewMode('detail');
    } else {
      showToast('error', '模拟失败');
    }
  };

  const handleApply = async (force: boolean = false) => {
    if (!currentSimulator) return;

    const result = await applySimulator(currentSimulator.id, force, currentUser);

    if (result.success) {
      showToast('success', '应用成功，已生成新规则版本');
      setShowApplyModal(false);
      await loadSimulators();
    } else if (result.conflicts && result.conflicts.length > 0) {
      setConflicts(result.conflicts);
      setPendingAction({ type: 'apply', simulatorId: currentSimulator.id, overwrite: force });
      setShowConflictModal(true);
    } else {
      showToast('error', '应用失败');
    }
  };

  const handleRevert = async () => {
    if (!currentSimulator) return;

    const result = await revertSimulator(currentSimulator.id, currentUser);

    if (result.success) {
      showToast('success', '撤销成功，已恢复到原规则版本');
      setShowRevertModal(false);
      await loadSimulators();
    } else {
      showToast('error', result.message || '撤销失败');
    }
  };

  const handleDelete = async () => {
    if (!currentSimulator) return;

    const success = await deleteSimulator(currentSimulator.id, currentUser);
    if (success) {
      showToast('success', '删除成功');
      setShowDeleteModal(false);
      selectSimulator(null);
      setViewMode('list');
    } else {
      showToast('error', '删除失败');
    }
  };

  const handleDuplicate = async () => {
    if (!currentSimulator) return;

    const newName = `${currentSimulator.name} (副本)`;
    const result = await duplicateSimulator(currentSimulator.id, newName, currentUser);
    if (result) {
      showToast('success', '复制成功');
      selectSimulator(result.id);
      setViewMode('edit');
    } else {
      showToast('error', '复制失败');
    }
  };

  const handleExport = async (simulatorIds?: string[]) => {
    try {
      const result = await exportSimulatorsToJSON(simulatorIds, currentUser);
      const jsonStr = JSON.stringify(result, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulators-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('success', '导出成功');
    } catch (e) {
      showToast('error', '导出失败');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      const result = await importSimulatorsFromJSON(jsonData, currentUser);
      setImportResult(result);
      setShowImportResultModal(true);

      if (result.imported.length > 0) {
        showToast('success', `成功导入 ${result.imported.length} 个方案`);
      }
      if (result.conflicts.length > 0) {
        showToast('warning', `存在 ${result.conflicts.length} 个冲突`);
      }

      await loadSimulators();
    } catch (err) {
      showToast('error', '导入文件格式错误');
    }

    e.target.value = '';
  };

  const handleForceImport = async (data: any, overwrite: boolean) => {
    try {
      const result = await forceImportSimulator(data, overwrite, currentUser);
      if (result) {
        showToast('success', overwrite ? '已覆盖现有方案' : '已重命名导入');
        setImportResult(null);
        setShowImportResultModal(false);
        await loadSimulators();
      }
    } catch (e) {
      showToast('error', '强制导入失败');
    }
  };

  const handleConflictResolve = async (resolution: 'overwrite' | 'rename' | 'reload' | 'cancel') => {
    if (resolution === 'cancel') {
      setShowConflictModal(false);
      setPendingAction(null);
      return;
    }

    if (resolution === 'reload' && pendingAction?.simulatorId) {
      const sim = await getSimulatorById(pendingAction.simulatorId);
      if (sim) {
        await updateSimulator({
          id: sim.id,
          operator: currentUser,
        });
        await loadSimulators();
      }
      setShowConflictModal(false);
      setPendingAction(null);
      return;
    }

    if (resolution === 'overwrite' && pendingAction) {
      if (pendingAction.type === 'save' && currentSimulator) {
        await handleSaveDraft(true);
      } else if (pendingAction.type === 'apply' && currentSimulator) {
        await handleApply(true);
      }
      setShowConflictModal(false);
      setPendingAction(null);
      return;
    }

    if (resolution === 'rename') {
      showToast('info', '请修改方案名称后重试');
      setShowConflictModal(false);
      setPendingAction(null);
    }
  };

  const toggleEmployee = (employeeId: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  };

  const getDiffIcon = (type: string) => {
    switch (type) {
      case 'added':
        return <ArrowUpCircle className="w-4 h-4 text-green-500" />;
      case 'removed':
        return <ArrowDownCircle className="w-4 h-4 text-red-500" />;
      case 'modified':
        return <MinusCircle className="w-4 h-4 text-orange-500" />;
      default:
        return null;
    }
  };

  const getDiffLabel = (type: string) => {
    switch (type) {
      case 'added':
        return '新增';
      case 'removed':
        return '移除';
      case 'modified':
        return '修改';
      default:
        return type;
    }
  };

  const renderList = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800">模拟方案列表</h3>
        <div className="flex gap-2">
          <button onClick={handleImportClick} className="btn-secondary flex items-center gap-2">
            <Upload size={16} />
            导入
          </button>
          <button
            onClick={() => handleExport()}
            className="btn-secondary flex items-center gap-2"
            disabled={filteredSimulators.length === 0}
          >
            <Download size={16} />
            导出全部
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
            disabled={batches.length === 0}
          >
            <Plus size={16} />
            新建方案
          </button>
        </div>
      </div>

      {filteredSimulators.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GitCompare size={48} className="text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-700 mb-2">暂无模拟方案</h3>
          <p className="text-sm text-slate-500 mb-6">
            点击右上角新建按钮创建第一个规则模拟方案
          </p>
          {batches.length > 0 && (
            <button onClick={() => setShowCreateModal(true)} className="btn-primary">
              新建方案
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredSimulators.map(sim => (
            <div
              key={sim.id}
              className={`card p-4 cursor-pointer transition-all hover:shadow-md ${
                currentSimulatorId === sim.id ? 'ring-2 ring-[#f97316]' : ''
              }`}
              onClick={() => {
                selectSimulator(sim.id);
                setViewMode('detail');
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-slate-800">{sim.name}</h4>
                    <span className={`badge ${STATUS_LABELS[sim.status]?.className || ''}`}>
                      {STATUS_LABELS[sim.status]?.label || sim.status}
                    </span>
                    {!checkSimulatorPermission(sim, currentUser, 'admin') && (
                      <EyeOff size={14} className="text-slate-400" />
                    )}
                  </div>
                  {sim.description && (
                    <p className="text-sm text-slate-500 mt-1">{sim.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Database size={12} />
                      {sim.sourceBatchName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      原异常 {sim.dataSnapshot.originalAnomalies.length} 条
                    </span>
                    {sim.simulationResult && (
                      <span className="flex items-center gap-1">
                        <CheckCircle size={12} />
                        模拟后 {sim.simulationResult.anomalies.length} 条
                      </span>
                    )}
                    {sim.simulationDiff && (
                      <span
                        className={`flex items-center gap-1 ${
                          sim.simulationDiff.summary.netChange > 0
                            ? 'text-red-500'
                            : sim.simulationDiff.summary.netChange < 0
                              ? 'text-green-500'
                              : 'text-slate-500'
                        }`}
                      >
                        <GitCompare size={12} />
                        差异 {sim.simulationDiff.summary.netChange > 0 ? '+' : ''}
                        {sim.simulationDiff.summary.netChange}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(sim.updatedAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleExport([sim.id]);
                    }}
                    className="p-1.5 hover:bg-slate-100 rounded"
                    title="导出"
                  >
                    <Download size={16} className="text-slate-500" />
                  </button>
                  {checkSimulatorPermission(sim, currentUser, 'admin') && (
                    <>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          selectSimulator(sim.id);
                          setViewMode('edit');
                        }}
                        className="p-1.5 hover:bg-slate-100 rounded"
                        title="编辑"
                      >
                        <Edit3 size={16} className="text-slate-500" />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          selectSimulator(sim.id);
                          setShowDeleteModal(true);
                        }}
                        className="p-1.5 hover:bg-red-50 rounded"
                        title="删除"
                      >
                        <Trash2 size={16} className="text-red-500" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {sim.status === 'applied' && sim.appliedAt && (
                <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-green-600 flex items-center gap-1">
                  <Shield size={12} />
                  由 {sim.appliedBy} 于 {new Date(sim.appliedAt).toLocaleString('zh-CN')} 应用
                </div>
              )}
              {sim.status === 'reverted' && sim.revertedAt && (
                <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-orange-600 flex items-center gap-1">
                  <RotateCcw size={12} />
                  由 {sim.revertedBy} 于 {new Date(sim.revertedAt).toLocaleString('zh-CN')} 撤销
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderDetail = () => {
    if (!currentSimulator || !canView) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <EyeOff size={48} className="text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-700 mb-2">无查看权限</h3>
          <p className="text-sm text-slate-500 mb-6">您没有权限查看此模拟方案</p>
          <button onClick={() => { selectSimulator(null); setViewMode('list'); }} className="btn-primary">
            返回列表
          </button>
        </div>
      );
    }

    const sim = currentSimulator;
    const originalCount = sim.dataSnapshot.originalAnomalies.length;
    const simulatedCount = sim.simulationResult?.anomalies.length || 0;
    const diff = sim.simulationDiff;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { selectSimulator(null); setViewMode('list'); }}
              className="p-1.5 hover:bg-slate-100 rounded"
            >
              <ChevronRight size={20} className="rotate-180 text-slate-500" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-slate-800">{sim.name}</h3>
                <span className={`badge ${STATUS_LABELS[sim.status]?.className || ''}`}>
                  {STATUS_LABELS[sim.status]?.label || sim.status}
                </span>
              </div>
              {sim.description && (
                <p className="text-sm text-slate-500 mt-0.5">{sim.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!canEdit ? (
              <span className="text-sm text-slate-500 flex items-center gap-1">
                <Eye size={14} />
                只读模式
              </span>
            ) : (
              <>
                <button
                  onClick={handleDuplicate}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Copy size={16} />
                  复制
                </button>
                <button
                  onClick={() => handleExport([sim.id])}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Download size={16} />
                  导出
                </button>
                {sim.status === 'draft' || sim.status === 'ready' || sim.status === 'conflicted' ? (
                  <button
                    onClick={() => setViewMode('edit')}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Edit3 size={16} />
                    编辑参数
                  </button>
                ) : null}
                {sim.status === 'ready' && (
                  <button
                    onClick={() => setShowApplyModal(true)}
                    className="btn-primary flex items-center gap-2"
                  >
                    <CheckCircle size={16} />
                    应用方案
                  </button>
                )}
                {sim.status === 'applied' && (
                  <button
                    onClick={() => setShowRevertModal(true)}
                    className="btn-secondary flex items-center gap-2 text-orange-600 border-orange-200 hover:bg-orange-50"
                  >
                    <RotateCcw size={16} />
                    撤销应用
                  </button>
                )}
                {(sim.status === 'draft' || sim.status === 'ready' || sim.status === 'reverted') && (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="btn-secondary flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={<AlertTriangle />}
            title="原异常总数"
            value={originalCount.toString()}
            color="orange"
          />
          <StatCard
            icon={<CheckCircle />}
            title="模拟后异常"
            value={simulatedCount.toString()}
            color="blue"
          />
          <StatCard
            icon={<GitCompare />}
            title="净变化"
            value={diff ? `${diff.summary.netChange > 0 ? '+' : ''}${diff.summary.netChange}` : '-'}
            color={diff && diff.summary.netChange < 0 ? 'green' : diff && diff.summary.netChange > 0 ? 'red' : 'purple'}
          />
          <StatCard
            icon={<Clock />}
            title="模拟耗时"
            value={sim.simulationResult ? `${sim.simulationResult.durationMs}ms` : '-'}
            color="purple"
          />
        </div>

        {diff && (
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              icon={<ArrowUpCircle />}
              title="新增异常"
              value={diff.summary.totalAdded.toString()}
              color="green"
            />
            <StatCard
              icon={<ArrowDownCircle />}
              title="移除异常"
              value={diff.summary.totalRemoved.toString()}
              color="red"
            />
            <StatCard
              icon={<MinusCircle />}
              title="修改异常"
              value={diff.summary.totalModified.toString()}
              color="orange"
            />
          </div>
        )}

        <div className="card p-4">
          <h4 className="font-medium text-slate-800 mb-3">当前参数配置</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-slate-500">迟到宽限时间</div>
              <div className="font-medium">{sim.params.lateGracePeriodMinutes} 分钟</div>
            </div>
            <div>
              <div className="text-sm text-slate-500">早退阈值</div>
              <div className="font-medium">{sim.params.earlyLeaveThresholdMinutes} 分钟</div>
            </div>
            <div>
              <div className="text-sm text-slate-500">跨日班次最大时长</div>
              <div className="font-medium">{sim.params.crossDayMaxHours} 小时</div>
            </div>
            <div>
              <div className="text-sm text-slate-500">重复打卡窗口</div>
              <div className="font-medium">{sim.params.duplicatePunchWindowMinutes} 分钟</div>
            </div>
          </div>
        </div>

        {diff && diff.items.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium text-slate-800">差异明细</h4>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="搜索员工..."
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    className="input pl-8 py-1.5 text-sm w-48"
                  />
                </div>
                <div className="flex gap-1">
                  {(['all', 'added', 'removed', 'modified'] as DiffFilter[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setDiffFilter(f)}
                      className={`px-3 py-1.5 text-sm rounded ${
                        diffFilter === f
                          ? 'bg-[#1e3a5f] text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {f === 'all' ? '全部' : getDiffLabel(f)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {Object.keys(employeeGroupedDiff).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Filter size={32} className="text-slate-300 mb-3" />
                <h4 className="text-base font-medium text-slate-700 mb-1">暂无差异数据</h4>
                <p className="text-sm text-slate-500">当前筛选条件下没有差异记录</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {Object.entries(employeeGroupedDiff).map(([employeeId, items]) => {
                  const firstItem = items[0];
                  const firstAnomaly = firstItem.simulated || firstItem.original;
                  const employeeName = firstAnomaly?.employeeName || employeeId;
                  const isExpanded = expandedEmployees.has(employeeId);

                  return (
                    <div key={employeeId} className="border border-slate-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleEmployee(employeeId)}
                        className="w-full flex items-center justify-between p-3 hover:bg-slate-50 text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <Users size={16} className="text-slate-400" />
                          <span className="font-medium">{employeeName}</span>
                          <span className="text-sm text-slate-500">({employeeId})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {items.filter(i => i.type === 'added').length > 0 && (
                            <span className="text-sm text-green-600">
                              +{items.filter(i => i.type === 'added').length}
                            </span>
                          )}
                          {items.filter(i => i.type === 'removed').length > 0 && (
                            <span className="text-sm text-red-600">
                              -{items.filter(i => i.type === 'removed').length}
                            </span>
                          )}
                          {items.filter(i => i.type === 'modified').length > 0 && (
                            <span className="text-sm text-orange-600">
                              ~{items.filter(i => i.type === 'modified').length}
                            </span>
                          )}
                          <span className="text-sm text-slate-500">
                            共 {items.length} 条
                          </span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-slate-200 divide-y divide-slate-100">
                          {items.map((item, idx) => {
                            const anomaly = item.simulated || item.original;
                            if (!anomaly) return null;

                            return (
                              <div key={idx} className="p-3 pl-11">
                                <div className="flex items-start gap-3">
                                  {getDiffIcon(item.type)}
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                                        item.type === 'added' ? 'bg-green-100 text-green-700' :
                                        item.type === 'removed' ? 'bg-red-100 text-red-700' :
                                        'bg-orange-100 text-orange-700'
                                      }`}>
                                        {getDiffLabel(item.type)}
                                      </span>
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                        {ANOMALY_TYPE_LABELS[anomaly.type] || anomaly.type}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {anomaly.scheduleDate}
                                      </span>
                                    </div>
                                    <p className="text-sm mt-1">{anomaly.description}</p>
                                    {item.type === 'modified' && item.original && item.simulated && (
                                      <div className="mt-2 text-xs space-y-1">
                                        <div className="text-red-500">
                                          - 原：{item.original.description}
                                          {item.original.durationMinutes !== undefined &&
                                            ` (${item.original.durationMinutes}分钟)`}
                                        </div>
                                        <div className="text-green-500">
                                          + 新：{item.simulated.description}
                                          {item.simulated.durationMinutes !== undefined &&
                                            ` (${item.simulated.durationMinutes}分钟)`}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    anomaly.severity === 'critical' ? 'bg-red-100 text-red-700' :
                                    anomaly.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                                    anomaly.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-slate-100 text-slate-700'
                                  }`}>
                                    {anomaly.severity === 'critical' ? '严重' :
                                     anomaly.severity === 'high' ? '高' :
                                     anomaly.severity === 'medium' ? '中' : '低'}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {diff && diff.summary.byType && (
          <div className="card p-4">
            <h4 className="font-medium text-slate-800 mb-3">按类型差异统计</h4>
            <div className="grid grid-cols-3 gap-3">
              {(Object.entries(diff.summary.byType) as [AnomalyType, number][])
                .filter(([, count]) => count !== 0)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([type, count]) => (
                  <div
                    key={type}
                    className={`p-3 rounded-lg border ${
                      count > 0 ? 'bg-red-50 border-red-200' :
                      count < 0 ? 'bg-green-50 border-green-200' :
                      'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="text-sm text-slate-600">
                      {ANOMALY_TYPE_LABELS[type] || type}
                    </div>
                    <div className={`text-lg font-semibold ${
                      count > 0 ? 'text-red-600' :
                      count < 0 ? 'text-green-600' :
                      'text-slate-600'
                    }`}>
                      {count > 0 ? '+' : ''}{count}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div className="card p-4">
          <h4 className="font-medium text-slate-800 mb-3">方案信息</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">创建人：</span>
              <span>{sim.createdBy}</span>
            </div>
            <div>
              <span className="text-slate-500">创建时间：</span>
              <span>{new Date(sim.createdAt).toLocaleString('zh-CN')}</span>
            </div>
            <div>
              <span className="text-slate-500">更新时间：</span>
              <span>{new Date(sim.updatedAt).toLocaleString('zh-CN')}</span>
            </div>
            <div>
              <span className="text-slate-500">所属批次：</span>
              <span>{sim.sourceBatchName}</span>
            </div>
            {sim.appliedAt && (
              <>
                <div>
                  <span className="text-slate-500">应用人：</span>
                  <span>{sim.appliedBy}</span>
                </div>
                <div>
                  <span className="text-slate-500">应用时间：</span>
                  <span>{new Date(sim.appliedAt).toLocaleString('zh-CN')}</span>
                </div>
              </>
            )}
            {sim.revertedAt && (
              <>
                <div>
                  <span className="text-slate-500">撤销人：</span>
                  <span>{sim.revertedBy}</span>
                </div>
                <div>
                  <span className="text-slate-500">撤销时间：</span>
                  <span>{new Date(sim.revertedAt).toLocaleString('zh-CN')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderEdit = () => {
    if (!currentSimulator || !canEdit) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldOff size={48} className="text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-700 mb-2">无编辑权限</h3>
          <p className="text-sm text-slate-500 mb-6">您没有权限编辑此模拟方案</p>
          <button onClick={() => { selectSimulator(null); setViewMode('list'); }} className="btn-primary">
            返回列表
          </button>
        </div>
      );
    }

    const sim = currentSimulator;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (hasUnsavedChanges) {
                  if (confirm('有未保存的更改，确定要离开吗？')) {
                    setViewMode('detail');
                  }
                } else {
                  setViewMode('detail');
                }
              }}
              className="p-1.5 hover:bg-slate-100 rounded"
            >
              <ChevronRight size={20} className="rotate-180 text-slate-500" />
            </button>
            <div>
              <h3 className="text-xl font-semibold text-slate-800">编辑模拟方案</h3>
              <p className="text-sm text-slate-500 mt-0.5">
                调整规则参数后立即查看模拟效果
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <span className="text-sm text-orange-500 flex items-center gap-1">
                <AlertTriangle size={14} />
                有未保存的更改
              </span>
            )}
            <button
              onClick={() => handleSaveDraft(false)}
              className="btn-secondary flex items-center gap-2"
            >
              <Save size={16} />
              保存草稿
            </button>
            <button
              onClick={handleRunSimulation}
              className="btn-primary flex items-center gap-2"
            >
              <Play size={16} />
              {sim.simulationResult ? '重新模拟' : '运行模拟'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="card p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                方案名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editName}
                onChange={e => {
                  setEditName(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="input w-full"
                placeholder="输入方案名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                方案描述
              </label>
              <textarea
                value={editDesc}
                onChange={e => {
                  setEditDesc(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="input w-full h-20 resize-none"
                placeholder="输入方案描述（可选）"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                源批次
              </label>
              <div className="p-2 bg-slate-50 rounded text-sm text-slate-600">
                {sim.sourceBatchName}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                原始异常数量
              </label>
              <div className="p-2 bg-slate-50 rounded text-sm text-slate-600">
                {sim.dataSnapshot.originalAnomalies.length} 条
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-5">
            <h4 className="font-medium text-slate-800">规则参数调整</h4>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                迟到宽限时间
                <span className="ml-2 text-slate-500 font-normal">
                  {editParams.lateGracePeriodMinutes} 分钟
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="120"
                step="5"
                value={editParams.lateGracePeriodMinutes}
                onChange={e => handleParamChange('lateGracePeriodMinutes', parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>0分钟</span>
                <span>120分钟</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                员工上班打卡晚于规定时间在此范围内不算迟到
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                早退阈值
                <span className="ml-2 text-slate-500 font-normal">
                  {editParams.earlyLeaveThresholdMinutes} 分钟
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="300"
                step="5"
                value={editParams.earlyLeaveThresholdMinutes}
                onChange={e => handleParamChange('earlyLeaveThresholdMinutes', parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>0分钟</span>
                <span>300分钟</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                员工下班打卡早于规定时间超过此阈值算早退
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                跨日班次最大时长
                <span className="ml-2 text-slate-500 font-normal">
                  {editParams.crossDayMaxHours} 小时
                </span>
              </label>
              <input
                type="range"
                min="8"
                max="24"
                step="1"
                value={editParams.crossDayMaxHours}
                onChange={e => handleParamChange('crossDayMaxHours', parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>8小时</span>
                <span>24小时</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                跨日班次（夜班）的最大工作时长，超过此时间判定为异常
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                重复打卡窗口
                <span className="ml-2 text-slate-500 font-normal">
                  {editParams.duplicatePunchWindowMinutes} 分钟
                </span>
              </label>
              <input
                type="range"
                min="1"
                max="60"
                step="1"
                value={editParams.duplicatePunchWindowMinutes}
                onChange={e => handleParamChange('duplicatePunchWindowMinutes', parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>1分钟</span>
                <span>60分钟</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                同一员工在此时间范围内的多次打卡视为重复打卡
              </p>
            </div>

            <button
              onClick={() => {
                setEditParams({ ...DEFAULT_PARAMS });
                setHasUnsavedChanges(true);
              }}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} />
              恢复默认参数
            </button>
          </div>
        </div>

        {sim.simulationResult && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-slate-800">上次模拟结果</h4>
              <span className="text-sm text-slate-500">
                模拟耗时 {sim.simulationResult.durationMs}ms
              </span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <StatCard
                icon={<AlertTriangle />}
                title="原异常"
                value={sim.dataSnapshot.originalAnomalies.length.toString()}
                color="orange"
              />
              <StatCard
                icon={<CheckCircle />}
                title="模拟后"
                value={sim.simulationResult.anomalies.length.toString()}
                color="blue"
              />
              {sim.simulationDiff && (
                <>
                  <StatCard
                    icon={<GitCompare />}
                    title="净变化"
                    value={`${sim.simulationDiff.summary.netChange > 0 ? '+' : ''}${sim.simulationDiff.summary.netChange}`}
                    color={sim.simulationDiff.summary.netChange < 0 ? 'green' : sim.simulationDiff.summary.netChange > 0 ? 'red' : 'purple'}
                  />
                  <StatCard
                    icon={<Users />}
                    title="影响员工"
                    value={new Set(
                      sim.simulationDiff.items
                        .map(i => (i.simulated || i.original)?.employeeId)
                        .filter(Boolean)
                    ).size.toString()}
                    color="purple"
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      {loading ? (
        <Loading text="加载中..." />
      ) : (
        <div className="min-h-[calc(100vh-120px)]">
          {viewMode === 'list' && renderList()}
          {viewMode === 'detail' && renderDetail()}
          {viewMode === 'edit' && renderEdit()}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="新建模拟方案"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              方案名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newSimName}
              onChange={e => setNewSimName(e.target.value)}
              className="input w-full"
              placeholder="如：放宽迟到宽限至30分钟"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              方案描述
            </label>
            <textarea
              value={newSimDesc}
              onChange={e => setNewSimDesc(e.target.value)}
              className="input w-full h-20 resize-none"
              placeholder="描述此方案的目的和预期效果（可选）"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              选择批次 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedBatchId}
              onChange={e => setSelectedBatchId(e.target.value)}
              className="input w-full"
            >
              <option value="">请选择批次</option>
              {batches.map(batch => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCreateModal(false)} className="btn-secondary">
              取消
            </button>
            <button onClick={handleCreateSimulator} className="btn-primary">
              创建
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="确认删除"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
            <AlertTriangle className="text-red-500" size={24} />
            <div>
              <p className="font-medium text-slate-800">
                确定要删除方案「{currentSimulator?.name}」吗？
              </p>
              <p className="text-sm text-slate-500">此操作不可撤销</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowDeleteModal(false)} className="btn-secondary">
              取消
            </button>
            <button onClick={handleDelete} className="btn-danger">
              确认删除
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        title="确认应用方案"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
            <Shield className="text-blue-500" size={24} />
            <div>
              <p className="font-medium text-slate-800">
                确定要应用方案「{currentSimulator?.name}」吗？
              </p>
              <p className="text-sm text-slate-500">
                应用后将生成新的规则版本并设为激活状态
              </p>
            </div>
          </div>
          {currentSimulator?.simulationDiff && (
            <div className="p-3 bg-slate-50 rounded-lg">
              <div className="text-sm font-medium text-slate-700 mb-2">预期影响：</div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-slate-500">新增异常：</span>
                  <span className="text-red-600 font-medium">
                    {currentSimulator.simulationDiff.summary.totalAdded} 条
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">移除异常：</span>
                  <span className="text-green-600 font-medium">
                    {currentSimulator.simulationDiff.summary.totalRemoved} 条
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">修改异常：</span>
                  <span className="text-orange-600 font-medium">
                    {currentSimulator.simulationDiff.summary.totalModified} 条
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowApplyModal(false)} className="btn-secondary">
              取消
            </button>
            <button onClick={() => handleApply(false)} className="btn-primary">
              确认应用
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showRevertModal}
        onClose={() => setShowRevertModal(false)}
        title="确认撤销应用"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
            <RotateCcw className="text-orange-500" size={24} />
            <div>
              <p className="font-medium text-slate-800">
                确定要撤销方案「{currentSimulator?.name}」的应用吗？
              </p>
              <p className="text-sm text-slate-500">
                将恢复到应用此方案之前的规则版本
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowRevertModal(false)} className="btn-secondary">
              取消
            </button>
            <button onClick={handleRevert} className="btn-primary bg-orange-500 hover:bg-orange-600">
              确认撤销
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showConflictModal}
        onClose={() => { setShowConflictModal(false); setPendingAction(null); }}
        title="检测到冲突"
      >
        <div className="space-y-4">
          {conflicts.map((conflict, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg ${
                conflict.severity === 'error'
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-yellow-50 border border-yellow-200'
              }`}
            >
              <div className="flex items-start gap-2">
                {conflict.severity === 'error' ? (
                  <XCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
                ) : (
                  <AlertTriangle className="text-yellow-500 flex-shrink-0 mt-0.5" size={18} />
                )}
                <div>
                  <div className="font-medium text-slate-800">{conflict.message}</div>
                  {conflict.details && (
                    <pre className="text-xs text-slate-500 mt-1 bg-white/50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(conflict.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            {conflicts[0]?.resolutionOptions.map(option => (
              <button
                key={option}
                onClick={() => handleConflictResolve(option)}
                className={`${
                  option === 'cancel'
                    ? 'btn-secondary'
                    : option === 'overwrite'
                      ? 'btn-danger'
                      : 'btn-primary'
                }`}
              >
                {option === 'overwrite' ? '强制覆盖' :
                 option === 'rename' ? '修改名称' :
                 option === 'reload' ? '重新加载' : '取消'}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showImportResultModal && importResult !== null}
        onClose={() => { setShowImportResultModal(false); setImportResult(null); }}
        title="导入结果"
        size="lg"
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {importResult && importResult.imported.length > 0 && (
            <div>
              <h4 className="font-medium text-green-600 mb-2 flex items-center gap-2">
                <CheckCircle size={16} />
                成功导入 {importResult.imported.length} 个方案
              </h4>
              <div className="space-y-1">
                {importResult.imported.map(sim => (
                  <div key={sim.id} className="text-sm p-2 bg-green-50 rounded">
                    {sim.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {importResult && importResult.skipped.length > 0 && (
            <div>
              <h4 className="font-medium text-yellow-600 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} />
                跳过 {importResult.skipped.length} 个方案
              </h4>
              <div className="space-y-2">
                {importResult.skipped.map((item, idx) => (
                  <div key={idx} className="text-sm p-2 bg-yellow-50 rounded flex justify-between">
                    <span>{item.data.name}</span>
                    <span className="text-yellow-600">{item.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importResult && importResult.conflicts.length > 0 && (
            <div>
              <h4 className="font-medium text-red-600 mb-2 flex items-center gap-2">
                <XCircle size={16} />
                存在 {importResult.conflicts.length} 个冲突
              </h4>
              <div className="space-y-2">
                {importResult.conflicts.map((conflict, idx) => (
                  <div key={idx} className="text-sm p-2 bg-red-50 rounded">
                    <div className="font-medium">{conflict.message}</div>
                    {conflict.details?.sourceBatchId && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleForceImport(
                            importResult!.skipped.find(s => s.data.name === conflict.details?.name)?.data,
                            true
                          )}
                          className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          覆盖现有
                        </button>
                        <button
                          onClick={() => handleForceImport(
                            importResult!.skipped.find(s => s.data.name === conflict.details?.name)?.data,
                            false
                          )}
                          className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                        >
                          重命名导入
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t">
            <button
              onClick={() => { setShowImportResultModal(false); setImportResult(null); }}
              className="btn-primary"
            >
              确定
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}

async function getSimulatorById(id: string): Promise<Simulator | undefined> {
  const { getSimulatorById } = await import('@/modules/simulator');
  return getSimulatorById(id);
}
