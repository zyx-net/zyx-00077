import { useState, useCallback, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Trash2,
  Plus,
  Settings,
} from 'lucide-react';
import Layout from '@/components/Layout';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import importModule from '@/modules/import';
import matchModule from '@/modules/match';
import rulesModule from '@/modules/rules';
import auditModule from '@/modules/audit';
import type {
  ImportPreview,
  ImportError,
  FieldMapping,
  ImportResult,
  ScheduleRecord,
  PunchRecord,
  LeaveRecord,
} from '@/types';

type DataType = 'schedule' | 'punch' | 'leave';

interface ImportState {
  schedule: {
    file: File | null;
    preview: ImportPreview | null;
    mapping: Record<string, string>;
    result: ImportResult<ScheduleRecord> | null;
    errors: ImportError[];
  };
  punch: {
    file: File | null;
    preview: ImportPreview | null;
    mapping: Record<string, string>;
    result: ImportResult<PunchRecord> | null;
    errors: ImportError[];
  };
  leave: {
    file: File | null;
    preview: ImportPreview | null;
    mapping: Record<string, string>;
    result: ImportResult<LeaveRecord> | null;
    errors: ImportError[];
  };
}

const dataTypeLabels: Record<DataType, string> = {
  schedule: '排班数据',
  punch: '打卡数据',
  leave: '调休数据',
};

const requiredFields: Record<DataType, string[]> = {
  schedule: ['employeeId', 'employeeName', 'scheduleDate', 'startTime', 'endTime'],
  punch: ['employeeId', 'punchTime'],
  leave: ['employeeId', 'leaveDate', 'leaveType', 'hours'],
};

const fieldLabels: Record<string, string> = {
  employeeId: '员工编号',
  employeeName: '员工姓名',
  department: '部门',
  scheduleDate: '排班日期',
  startTime: '上班时间',
  endTime: '下班时间',
  shiftType: '班次类型',
  breakStartTime: '休息开始',
  breakEndTime: '休息结束',
  punchTime: '打卡时间',
  punchType: '打卡类型',
  deviceId: '设备编号',
  location: '打卡地点',
  leaveDate: '请假日期',
  leaveType: '请假类型',
  hours: '时长(小时)',
  reason: '原因',
};

export default function ImportPage() {
  const {
    currentBatchId,
    batches,
    createBatch,
    selectBatch,
    saveSchedules,
    savePunches,
    saveLeaves,
    saveMatchedRecords,
    saveAnomalies,
    updateFieldMapping,
    updateBatchStats,
    loading,
    recordAuditLog,
    getCurrentStatsSnapshot,
    analyzeAnomalies,
    getCurrentBatch,
  } = useAppStore();
  const { showToast } = useToast();

  const [batchName, setBatchName] = useState('');
  const [showCreateBatch, setShowCreateBatch] = useState(false);
  const [activeTab, setActiveTab] = useState<DataType>('schedule');
  const [importState, setImportState] = useState<ImportState>({
    schedule: { file: null, preview: null, mapping: {}, result: null, errors: [] },
    punch: { file: null, preview: null, mapping: {}, result: null, errors: [] },
    leave: { file: null, preview: null, mapping: {}, result: null, errors: [] },
  });
  const [isDragging, setIsDragging] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentBatch = getCurrentBatch();

  const handleCreateBatch = async () => {
    if (!batchName.trim()) {
      showToast('error', '请输入批次名称');
      return;
    }
    try {
      const batch = await createBatch(batchName.trim());
      await selectBatch(batch.id);
      setShowCreateBatch(false);
      setBatchName('');
      showToast('success', `批次 "${batch.name}" 创建成功`);
    } catch (error) {
      showToast('error', '创建批次失败');
    }
  };

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!currentBatchId) {
        showToast('error', '请先创建或选择批次');
        return;
      }

      const file = files[0];
      const fileType = importModule.detectFileType(file);

      if (fileType === 'unknown') {
        showToast('error', '不支持的文件类型，请上传CSV或Excel文件');
        return;
      }

      try {
        const preview = await importModule.getImportPreview(file);
        const mapping = importModule.autoDetectMapping(preview.headers, activeTab);

        setImportState(prev => ({
          ...prev,
          [activeTab]: {
            ...prev[activeTab],
            file,
            preview,
            mapping,
            result: null,
            errors: [],
          },
        }));

        showToast('success', `文件 "${file.name}" 加载成功，共 ${preview.rowCount} 行数据`);
      } catch (error) {
        showToast('error', error instanceof Error ? error.message : '文件解析失败');
      }
    },
    [activeTab, currentBatchId, showToast]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect]
  );

  const handleMappingChange = (field: string, value: string) => {
    setImportState(prev => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        mapping: {
          ...prev[activeTab].mapping,
          [field]: value,
        },
      },
    }));
  };

  const validateAndPreview = async () => {
    const state = importState[activeTab];
    if (!state.preview || !currentBatchId) return;

    try {
      let result: ImportResult<any>;

      if (activeTab === 'schedule') {
        result = importModule.transformScheduleData(
          state.preview.sampleData,
          state.mapping,
          currentBatchId
        );
      } else if (activeTab === 'punch') {
        result = importModule.transformPunchData(
          state.preview.sampleData,
          state.mapping,
          currentBatchId,
          currentBatch?.timezone
        );
      } else {
        result = importModule.transformLeaveData(
          state.preview.sampleData,
          state.mapping,
          currentBatchId
        );
      }

      setImportState(prev => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          result,
          errors: result.errors,
        },
      }));

      if (result.errors.length > 0) {
        showToast('warning', `检测到 ${result.errors.length} 个错误，请修正后再导入`);
      } else {
        showToast('success', '数据校验通过，可以导入');
      }
    } catch (error) {
      showToast('error', '数据校验失败');
    }
  };

  const handleImport = async () => {
    const state = importState[activeTab];
    if (!state.preview || !currentBatchId) return;

    if (state.errors.length > 0) {
      showToast('error', '请先修正数据错误');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;
    let importCount = 0;
    let importErrorCount = 0;

    setIsProcessing(true);
    setImportProgress(0);

    try {
      setImportProgress(10);

      let rawData = state.preview.sampleData;
      if (state.preview.fileType === 'csv') {
        const parsed = await importModule.parseCSV(state.file!);
        rawData = parsed.data;
      } else if (state.preview.fileType === 'excel') {
        const parsed = await importModule.parseExcel(state.file!);
        rawData = parsed.data;
      }

      setImportProgress(30);

      let result: ImportResult<any>;
      if (activeTab === 'schedule') {
        result = importModule.transformScheduleData(rawData, state.mapping, currentBatchId);
        if (result.success) {
          await saveSchedules(result.data);
        }
      } else if (activeTab === 'punch') {
        result = importModule.transformPunchData(
          rawData,
          state.mapping,
          currentBatchId,
          currentBatch?.timezone
        );
        if (result.success) {
          await savePunches(result.data);
        }
      } else {
        result = importModule.transformLeaveData(rawData, state.mapping, currentBatchId);
        if (result.success) {
          await saveLeaves(result.data);
        }
      }

      importCount = result.validRows;
      importErrorCount = result.errors.length;

      setImportProgress(60);

      if (!result.success) {
        setImportState(prev => ({
          ...prev,
          [activeTab]: {
            ...prev[activeTab],
            result,
            errors: result.errors,
          },
        }));
        showToast('error', `导入失败，发现 ${result.errors.length} 个错误`);
        errorMessage = `导入失败，发现 ${result.errors.length} 个错误`;
        return;
      }

      await updateFieldMapping(currentBatchId, {
        ...currentBatch?.fieldMapping,
        [activeTab]: state.mapping,
      } as FieldMapping);

      setImportProgress(80);

      const allImported =
        importState.schedule.result?.success &&
        importState.punch.result?.success &&
        (activeTab === 'leave' ? result.success : importState.leave.result?.success || true);

      if (allImported) {
        showToast('info', '正在进行数据匹配和异常分析...');
      }

      setImportProgress(100);
      showToast(
        'success',
        `${dataTypeLabels[activeTab]}导入成功，共 ${result.validRows} 条有效数据`
      );
      success = true;

      setImportState(prev => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          file: null,
          preview: null,
          result,
          errors: [],
        },
      }));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '导入失败';
      showToast('error', errorMessage);
    } finally {
      setIsProcessing(false);
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'import',
        description: `导入${dataTypeLabels[activeTab]}：${state.file?.name || '未知文件'}，共 ${importCount} 条有效数据${importErrorCount > 0 ? `，${importErrorCount} 条错误` : ''}`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          dataType: activeTab,
          fileName: state.file?.name,
          fileType: state.preview?.fileType,
          importCount,
          errorCount: importErrorCount,
          mapping: state.mapping,
        },
        linkedEntityIds: {},
      });
    }
  };

  const handleProcessAll = async () => {
    if (!currentBatchId) return;

    const statsBefore = getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;
    let matchedCount = 0;
    let anomalyCount = 0;

    setIsProcessing(true);
    setImportProgress(0);

    try {
      const { schedules, punches, leaves } = useAppStore.getState();

      if (schedules.length === 0 || punches.length === 0) {
        showToast('error', '请先导入排班数据和打卡数据');
        errorMessage = '请先导入排班数据和打卡数据';
        return;
      }

      setImportProgress(20);
      showToast('info', '正在进行数据匹配...');

      const matchResult = matchModule.matchSchedulesAndPunches(
        schedules,
        punches,
        leaves
      );

      matchedCount = matchResult.matched.length;
      await saveMatchedRecords(matchResult.matched);

      setImportProgress(50);
      showToast('info', '正在进行异常分析...');

      const { activeRuleVersion } = useAppStore.getState();
      if (!activeRuleVersion) {
        throw new Error('未找到激活的规则版本');
      }

      const ruleResult = await rulesModule.runAnomalyDetection(
        matchResult.matched,
        activeRuleVersion.id
      );

      anomalyCount = ruleResult.anomalies.length;
      await saveAnomalies(ruleResult.anomalies);

      setImportProgress(80);

      await updateBatchStats(currentBatchId, {
        totalAnomalies: ruleResult.anomalies.length,
        pendingAnomalies: ruleResult.anomalies.filter(a => a.status === 'pending').length,
        correctedAnomalies: 0,
      });

      await analyzeAnomalies();

      setImportProgress(100);
      showToast(
        'success',
        `处理完成！匹配 ${matchResult.matched.length} 条记录，发现 ${ruleResult.anomalies.length} 个异常`
      );
      success = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '处理失败';
      showToast('error', errorMessage);
    } finally {
      setIsProcessing(false);
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'analyze',
        description: `数据分析完成：匹配 ${matchedCount} 条记录，发现 ${anomalyCount} 个异常`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          matchedCount,
          anomalyCount,
          ruleVersionId: useAppStore.getState().activeRuleVersion?.id,
          ruleVersionName: useAppStore.getState().activeRuleVersion?.name,
        },
        linkedEntityIds: {
          ruleVersionIds: useAppStore.getState().activeRuleVersion?.id ? [useAppStore.getState().activeRuleVersion.id] : [],
        },
      });
    }
  };

  const clearFile = (type: DataType) => {
    setImportState(prev => ({
      ...prev,
      [type]: { file: null, preview: null, mapping: {}, result: null, errors: [] },
    }));
  };

  const downloadSample = (type: DataType) => {
    const samples: Record<DataType, string> = {
      schedule: '/sample-data/normal/schedule.csv',
      punch: '/sample-data/normal/punch.csv',
      leave: '/sample-data/normal/leave.csv',
    };
    window.open(samples[type], '_blank');
    showToast('info', '开始下载样例数据');
  };

  const currentState = importState[activeTab];

  return (
    <Layout>
      {loading && <Loading fullScreen text="加载中..." />}
      {isProcessing && (
        <Loading fullScreen text={`处理中... ${importProgress}%`} />
      )}

      <div className="space-y-6">
        {!currentBatchId ? (
          <div className="card p-8 text-center">
            <Upload size={48} className="mx-auto text-[#f97316] mb-4" />
            <h3 className="text-xl font-semibold text-slate-800 mb-2">开始数据导入</h3>
            <p className="text-slate-500 mb-6">请先创建一个新批次或选择已有批次</p>
            <div className="flex justify-center gap-4">
              <button className="btn-primary" onClick={() => setShowCreateBatch(true)}>
                <Plus size={18} className="inline mr-2" />
                创建新批次
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  当前批次: {currentBatch?.name}
                </h3>
                <p className="text-sm text-slate-500">
                  创建时间: {new Date(currentBatch?.createdAt || '').toLocaleString('zh-CN')}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="btn-secondary"
                  onClick={() => setShowCreateBatch(true)}
                >
                  <Plus size={18} className="inline mr-2" />
                  新建批次
                </button>
                <button
                  className="btn-primary"
                  onClick={handleProcessAll}
                  disabled={isProcessing}
                >
                  <RefreshCw size={18} className="inline mr-2" />
                  开始分析
                </button>
              </div>
            </div>

            <div className="card">
              <div className="flex border-b border-slate-200">
                {(Object.keys(dataTypeLabels) as DataType[]).map(type => (
                  <button
                    key={type}
                    className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                      activeTab === type
                        ? 'text-[#1e3a5f] border-b-2 border-[#1e3a5f] bg-slate-50'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab(type)}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <FileSpreadsheet size={18} />
                      {dataTypeLabels[type]}
                      {importState[type].result?.success && (
                        <CheckCircle size={16} className="text-green-500" />
                      )}
                    </div>
                    {importState[type].result && (
                      <div className="text-xs mt-1">
                        {importState[type].result.validRows} 条有效数据
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-slate-500">
                    支持 CSV、Excel 格式文件，最大 10MB
                  </div>
                  <button
                    className="text-sm text-[#1e3a5f] hover:underline flex items-center gap-1"
                    onClick={() => downloadSample(activeTab)}
                  >
                    <Download size={14} />
                    下载样例数据
                  </button>
                </div>

                {!currentState.preview ? (
                  <div
                    className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                      isDragging
                        ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                        : 'border-slate-300 hover:border-[#1e3a5f]'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload
                      size={48}
                      className={`mx-auto mb-4 ${isDragging ? 'text-[#1e3a5f]' : 'text-slate-400'}`}
                    />
                    <p className="text-lg font-medium text-slate-700 mb-2">
                      拖拽文件到此处或点击上传
                    </p>
                    <p className="text-sm text-slate-500 mb-4">
                      支持 {dataTypeLabels[activeTab]} 文件
                    </p>
                    <button className="btn-secondary">选择文件</button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={e => handleFileSelect(e.target.files)}
                    />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet size={24} className="text-[#1e3a5f]" />
                        <div>
                          <p className="font-medium text-slate-800">
                            {currentState.preview.fileName}
                          </p>
                          <p className="text-sm text-slate-500">
                            {currentState.preview.rowCount} 行数据 ·{' '}
                            {currentState.preview.headers.length} 列
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                          onClick={() => setShowMappingModal(true)}
                        >
                          <Settings size={18} className="text-slate-600" />
                        </button>
                        <button
                          className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                          onClick={() => clearFile(activeTab)}
                        >
                          <Trash2 size={18} className="text-red-500" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4">
                      <button className="btn-secondary" onClick={validateAndPreview}>
                        <CheckCircle size={18} className="inline mr-2" />
                        校验数据
                      </button>
                      <button
                        className="btn-primary"
                        onClick={handleImport}
                        disabled={isProcessing || currentState.errors.length > 0}
                      >
                        <ArrowRight size={18} className="inline mr-2" />
                        导入数据
                      </button>
                    </div>

                    {currentState.errors.length > 0 && (
                      <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <XCircle size={20} className="text-red-500" />
                          <span className="font-medium text-red-800">
                            发现 {currentState.errors.length} 个错误
                          </span>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-2">
                          {currentState.errors.slice(0, 10).map((error, idx) => (
                            <div
                              key={idx}
                              className="text-sm text-red-700 flex items-start gap-2"
                            >
                              <span className="bg-red-200 text-red-800 px-2 py-0.5 rounded text-xs">
                                第{error.row}行
                              </span>
                              {error.column && (
                                <span className="bg-red-200 text-red-800 px-2 py-0.5 rounded text-xs">
                                  {error.column}
                                </span>
                              )}
                              <span>{error.message}</span>
                            </div>
                          ))}
                          {currentState.errors.length > 10 && (
                            <div className="text-sm text-red-600">
                              ... 还有 {currentState.errors.length - 10} 个错误
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {currentState.preview && (
                      <div>
                        <h4 className="font-medium text-slate-800 mb-3">数据预览（前10行）</h4>
                        <div className="table-container border border-slate-200 rounded-lg">
                          <table className="table">
                            <thead>
                              <tr>
                                <th className="sticky left-0 bg-slate-50">#</th>
                                {currentState.preview.headers.map((header, idx) => (
                                  <th key={idx}>{header}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {currentState.preview.sampleData.map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                  <td className="sticky left-0 bg-slate-50 font-medium">
                                    {rowIdx + 1}
                                  </td>
                                  {currentState.preview.headers.map((header, colIdx) => (
                                    <td key={colIdx} className="truncate max-w-xs">
                                      {String(row[header] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">导入进度</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(Object.keys(dataTypeLabels) as DataType[]).map(type => {
                  const state = importState[type];
                  const isComplete = state.result?.success || false;
                  const hasData = state.result?.data.length || 0;

                  return (
                    <div
                      key={type}
                      className={`p-4 rounded-lg border ${
                        isComplete
                          ? 'border-green-200 bg-green-50'
                          : hasData
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-slate-700">
                          {dataTypeLabels[type]}
                        </span>
                        {isComplete ? (
                          <CheckCircle size={20} className="text-green-500" />
                        ) : state.errors.length > 0 ? (
                          <AlertTriangle size={20} className="text-amber-500" />
                        ) : null}
                      </div>
                      <div className="text-2xl font-bold text-slate-800">
                        {state.result?.validRows || 0}
                      </div>
                      <div className="text-sm text-slate-500">条数据</div>
                    </div>
                  );
                })}
              </div>

              {isProcessing && (
                <div className="mt-4">
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-[#1e3a5f] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={showCreateBatch}
        onClose={() => setShowCreateBatch(false)}
        title="创建新批次"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowCreateBatch(false)}>
              取消
            </button>
            <button className="btn-primary" onClick={handleCreateBatch}>
              创建
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              批次名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input-field"
              value={batchName}
              onChange={e => setBatchName(e.target.value)}
              placeholder="例如：2024年1月考勤数据"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">备注</label>
            <textarea
              className="input-field min-h-24"
              placeholder="可选，描述批次用途..."
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showMappingModal}
        onClose={() => setShowMappingModal(false)}
        title="字段映射配置"
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowMappingModal(false)}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setShowMappingModal(false);
                validateAndPreview();
              }}
            >
              保存并校验
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500 mb-4">
            请确认系统自动检测的字段映射是否正确，如有误请手动调整。
          </p>

          <div className="space-y-3">
            {requiredFields[activeTab].map(field => (
              <div key={field} className="flex items-center gap-4">
                <label className="w-32 text-sm font-medium text-slate-700 flex-shrink-0">
                  {fieldLabels[field] || field}
                  <span className="text-red-500">*</span>
                </label>
                <select
                  className="select-field flex-1"
                  value={currentState.mapping[field] || ''}
                  onChange={e => handleMappingChange(field, e.target.value)}
                >
                  <option value="">-- 请选择 --</option>
                  {currentState.preview?.headers.map((header, idx) => (
                    <option key={idx} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            {Object.entries(currentState.mapping)
              .filter(([field]) => !requiredFields[activeTab].includes(field))
              .map(([field, value]) => (
                <div key={field} className="flex items-center gap-4">
                  <label className="w-32 text-sm font-medium text-slate-600 flex-shrink-0">
                    {fieldLabels[field] || field}
                  </label>
                  <select
                    className="select-field flex-1"
                    value={value || ''}
                    onChange={e => handleMappingChange(field, e.target.value)}
                  >
                    <option value="">-- 不导入 --</option>
                    {currentState.preview?.headers.map((header, idx) => (
                      <option key={idx} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200">
            <button
              className="text-sm text-[#1e3a5f] hover:underline"
              onClick={() => {
                const mapping = importModule.autoDetectMapping(
                  currentState.preview?.headers || [],
                  activeTab
                );
                setImportState(prev => ({
                  ...prev,
                  [activeTab]: {
                    ...prev[activeTab],
                    mapping,
                  },
                }));
              }}
            >
              <RefreshCw size={14} className="inline mr-1" />
              重新自动检测
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
