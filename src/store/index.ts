import { create } from 'zustand';
import type {
  Batch,
  ScheduleRecord,
  PunchRecord,
  LeaveRecord,
  Anomaly,
  MatchedRecord,
  Correction,
  RuleVersion,
  FieldMapping,
  BatchStats,
  AuditLogEntry,
  AuditExportSnapshot,
  AuditStatsSnapshot,
  AuditActionType,
  Preset,
  PresetType,
  ImportPresetConfig,
  ExportPresetConfig,
  PresetConflict,
  PresetSaveResult,
  PresetApplyResult,
  PresetActionType,
  Appeal,
  AppealStatus,
  AppealCreateParams,
  AppealReviewParams,
  AppealConflict,
  Simulator,
  SimulatorCreateParams,
  SimulatorUpdateParams,
  SimulatorConflict,
  SimulatorSaveResult,
  SimulatorApplyResult,
  SimulatorRevertResult,
  SimulationResult,
  SimulationDiff,
  SimulatorRuleParams,
} from '../types';
import { generateId, getDefaultTimezone } from '../utils/dateUtils';
import {
  batchOperations,
  scheduleOperations,
  punchOperations,
  leaveOperations,
  anomalyOperations,
  correctionOperations,
  matchedRecordOperations,
  ruleVersionOperations,
  auditLogOperations,
  auditExportSnapshotOperations,
  presetOperations,
  appealOperations,
  simulatorOperations,
} from '../db';
import { initializeRuleVersions } from '../modules/rules';
import { revertCorrection } from '../modules/correction';
import {
  createStatsSnapshot,
  createAuditLog,
  getBatchAuditTimeline,
  getExportSnapshots,
  checkRestoreConflicts,
  restoreToSnapshot,
  createExportSnapshot,
} from '../modules/audit';
import {
  savePreset,
  updatePreset,
  duplicatePreset,
  deletePreset,
  getPresets,
  getPresetById,
  applyPreset,
  exportPresetsToJSON,
  importPresetsFromJSON,
  forceImportPreset,
  generatePresetSummary,
} from '../modules/presets';
import {
  createAppeal,
  approveAppeal,
  rejectAppeal,
  revokeAppeal,
  getAppealsByBatchId,
  checkConflicts,
} from '../modules/appeal';
import {
  createSimulator,
  runSimulation,
  updateSimulator,
  duplicateSimulator,
  deleteSimulator,
  getSimulators,
  getSimulatorById,
  saveSimulatorDraft,
  applySimulator,
  revertSimulator,
  checkConflicts as checkSimulatorConflicts,
  checkPermission as checkSimulatorPermission,
  exportSimulatorsToJSON,
  importSimulatorsFromJSON,
  forceImportSimulator,
  generateSimulatorSummary,
} from '../modules/simulator';

interface AppState {
  initialized: boolean;
  currentBatchId: string | null;
  batches: Batch[];
  schedules: ScheduleRecord[];
  punches: PunchRecord[];
  leaves: LeaveRecord[];
  anomalies: Anomaly[];
  matchedRecords: MatchedRecord[];
  corrections: Correction[];
  ruleVersions: RuleVersion[];
  activeRuleVersion: RuleVersion | null;
  auditLogs: AuditLogEntry[];
  exportSnapshots: AuditExportSnapshot[];
  presets: Preset[];
  appeals: Appeal[];
  loading: boolean;
  error: string | null;
  
  getCurrentBatch: () => Batch | undefined;
  
  initApp: () => Promise<void>;
  loadBatches: () => Promise<void>;
  createBatch: (name: string, timezone?: string) => Promise<Batch>;
  selectBatch: (batchId: string) => Promise<void>;
  deleteBatch: (batchId: string) => Promise<void>;
  
  saveSchedules: (schedules: ScheduleRecord[]) => Promise<void>;
  savePunches: (punches: PunchRecord[]) => Promise<void>;
  saveLeaves: (leaves: LeaveRecord[]) => Promise<void>;
  saveMatchedRecords: (records: MatchedRecord[]) => Promise<void>;
  saveAnomalies: (anomalies: Anomaly[]) => Promise<void>;
  
  updateAnomaly: (anomaly: Anomaly) => Promise<void>;
  updateAnomalies: (anomalies: Anomaly[]) => Promise<void>;
  
  addCorrection: (correction: Correction) => Promise<void>;
  revertCorrection: (correctionId: string) => Promise<boolean>;
  
  loadRuleVersions: () => Promise<void>;
  setActiveRuleVersion: (versionId: string) => Promise<void>;
  
  updateBatchStats: (batchId: string, stats: Partial<BatchStats>) => Promise<void>;
  
  updateFieldMapping: (batchId: string, mapping: FieldMapping) => Promise<void>;
  
  clearCurrentBatchData: () => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  
  analyzeAnomalies: () => Promise<void>;

  loadAuditLogs: (batchId: string) => Promise<void>;
  loadExportSnapshots: (batchId: string) => Promise<void>;
  recordAuditLog: (params: import('../modules/audit').CreateAuditLogParams) => Promise<AuditLogEntry>;
  getCurrentStatsSnapshot: () => AuditStatsSnapshot;
  createExportSnapshot: (format: string, includeAuditSummary: boolean) => Promise<AuditExportSnapshot>;
  checkRestoreConflicts: (snapshotId: string) => Promise<import('../types').RestoreCheckResult>;
  restoreToSnapshot: (snapshotId: string, force?: boolean) => Promise<{ success: boolean; message: string; conflicts?: import('../types').RestoreCheckResult['conflicts'] }>;
  incrementStatsVersion: (batchId: string) => Promise<number>;

  loadPresets: (type?: PresetType) => Promise<void>;
  saveImportPreset: (params: { name: string; description?: string; config: ImportPresetConfig; overwrite?: boolean; operator?: string }) => Promise<PresetSaveResult>;
  saveExportPreset: (params: { name: string; description?: string; config: ExportPresetConfig; overwrite?: boolean; operator?: string }) => Promise<PresetSaveResult>;
  updatePreset: (params: { id: string; name?: string; description?: string; config?: ImportPresetConfig | ExportPresetConfig; operator?: string }) => Promise<Preset | null>;
  renamePreset: (presetId: string, newName: string, operator?: string) => Promise<Preset | null>;
  duplicatePreset: (presetId: string, newName: string, operator?: string) => Promise<Preset | null>;
  deletePreset: (presetId: string, operator?: string) => Promise<boolean>;
  applyPreset: (presetId: string, force?: boolean, operator?: string) => Promise<PresetApplyResult>;
  exportPresetsToJSON: (presetIds?: string[]) => ReturnType<typeof exportPresetsToJSON>;
  importPresetsFromJSON: (jsonData: Awaited<ReturnType<typeof exportPresetsToJSON>>, operator?: string) => ReturnType<typeof importPresetsFromJSON>;
  forceImportPreset: (presetData: Preset, overwrite: boolean, operator?: string) => Promise<Preset>;
  recordPresetAuditLog: (params: {
    batchId?: string;
    action: PresetActionType;
    preset: Preset;
    operator?: string;
    success: boolean;
    errorMessage?: string;
    oldPreset?: Preset;
    metadata?: Record<string, any>;
  }) => Promise<AuditLogEntry>;

  loadAppeals: (batchId: string, status?: AppealStatus) => Promise<void>;
  createAppeal: (params: AppealCreateParams) => Promise<{ success: boolean; appeal?: Appeal; conflicts?: AppealConflict[] }>;
  approveAppeal: (params: AppealReviewParams) => Promise<{ success: boolean; appeal?: Appeal; conflicts?: AppealConflict[] }>;
  rejectAppeal: (params: AppealReviewParams) => Promise<{ success: boolean; appeal?: Appeal; conflicts?: AppealConflict[] }>;
  revokeAppeal: (appealId: string, operator?: string) => Promise<{ success: boolean; appeal?: Appeal; conflicts?: AppealConflict[] }>;
  checkAppealConflicts: (anomalyId: string) => Promise<AppealConflict[]>;
  recordAppealAuditLog: (params: {
    batchId: string;
    action: 'appeal_create' | 'appeal_approve' | 'appeal_reject' | 'appeal_revoke' | 'appeal_auto_correct';
    appeal: Appeal;
    operator?: string;
    success: boolean;
    errorMessage?: string;
    metadata?: Record<string, any>;
  }) => Promise<AuditLogEntry>;

  simulators: Simulator[];
  currentSimulatorId: string | null;
  loadSimulators: (sourceBatchId?: string) => Promise<void>;
  createSimulator: (params: SimulatorCreateParams) => Promise<SimulatorSaveResult>;
  selectSimulator: (simulatorId: string | null) => void;
  updateSimulator: (params: SimulatorUpdateParams) => Promise<Simulator | null>;
  runSimulation: (simulatorId: string) => Promise<{ simulator: Simulator; result: SimulationResult; diff: SimulationDiff } | null>;
  duplicateSimulator: (simulatorId: string, newName: string, operator?: string) => Promise<Simulator | null>;
  deleteSimulator: (simulatorId: string, operator?: string) => Promise<boolean>;
  saveSimulatorDraft: (simulator: Simulator, overwrite?: boolean, operator?: string) => Promise<SimulatorSaveResult>;
  applySimulator: (simulatorId: string, force?: boolean, operator?: string) => Promise<SimulatorApplyResult>;
  revertSimulator: (simulatorId: string, operator?: string) => Promise<SimulatorRevertResult>;
  checkSimulatorConflicts: (simulatorId: string) => Promise<SimulatorConflict[]>;
  checkSimulatorPermission: (simulator: Simulator, user: string, required: 'readonly' | 'admin') => boolean;
  exportSimulatorsToJSON: (simulatorIds?: string[], operator?: string) => ReturnType<typeof exportSimulatorsToJSON>;
  importSimulatorsFromJSON: (jsonData: Awaited<ReturnType<typeof exportSimulatorsToJSON>>, operator?: string) => ReturnType<typeof importSimulatorsFromJSON>;
  forceImportSimulator: (simData: Omit<Simulator, 'id'>, overwrite: boolean, operator?: string) => Promise<Simulator>;
  recordSimulatorAuditLog: (params: {
    batchId: string;
    action: import('../types').SimulatorActionType;
    simulator: Simulator;
    operator?: string;
    success: boolean;
    errorMessage?: string;
    oldSimulator?: Simulator;
    metadata?: Record<string, any>;
  }) => Promise<AuditLogEntry>;
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  currentBatchId: null,
  batches: [],
  schedules: [],
  punches: [],
  leaves: [],
  anomalies: [],
  matchedRecords: [],
  corrections: [],
  ruleVersions: [],
  activeRuleVersion: null,
  auditLogs: [],
  exportSnapshots: [],
  presets: [],
  appeals: [],
  simulators: [],
  currentSimulatorId: null,
  loading: false,
  error: null,

  initApp: async () => {
    try {
      set({ loading: true });
      await initializeRuleVersions();
      await get().loadBatches();
      await get().loadRuleVersions();
      await get().loadPresets();
      set({ initialized: true, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '初始化失败', loading: false });
    }
  },

  loadBatches: async () => {
    try {
      const batches = await batchOperations.getAll();
      set({ batches: batches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载批次失败' });
    }
  },

  createBatch: async (name: string, timezone?: string) => {
    const batch: Batch = {
      id: generateId(),
      name,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
      timezone: timezone || getDefaultTimezone(),
      fieldMapping: {
        schedule: {},
        punch: {},
        leave: {},
      },
      stats: {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 0,
        pendingAnomalies: 0,
        correctedAnomalies: 0,
      },
      statsVersion: 0,
    };
    
    await batchOperations.add(batch);
    await get().loadBatches();
    
    const emptyStats = createStatsSnapshot(batch.stats);
    await createAuditLog({
      batchId: batch.id,
      action: 'batch_create',
      description: `创建批次：${name}`,
      success: true,
      statsBefore: emptyStats,
      statsAfter: emptyStats,
      metadata: { timezone: batch.timezone },
      statsVersion: 0,
    });
    
    return batch;
  },

  selectBatch: async (batchId: string) => {
    try {
      set({ loading: true, currentBatchId: batchId });
      
      const [schedules, punches, leaves, anomalies, corrections, matchedRecords, auditLogs, exportSnapshots, appeals] = await Promise.all([
        scheduleOperations.getByBatchId(batchId),
        punchOperations.getByBatchId(batchId),
        leaveOperations.getByBatchId(batchId),
        anomalyOperations.getByBatchId(batchId),
        correctionOperations.getByBatchId(batchId),
        matchedRecordOperations.getByBatchId(batchId),
        auditLogOperations.getByBatchId(batchId),
        auditExportSnapshotOperations.getByBatchId(batchId),
        appealOperations.getByBatchId(batchId),
      ]);
      
      set({
        schedules,
        punches,
        leaves,
        anomalies,
        corrections,
        matchedRecords,
        auditLogs: auditLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        exportSnapshots: exportSnapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        appeals: appeals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载批次数据失败', loading: false });
    }
  },

  deleteBatch: async (batchId: string) => {
    try {
      await batchOperations.delete(batchId);
      await get().loadBatches();
      if (get().currentBatchId === batchId) {
        get().clearCurrentBatchData();
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '删除批次失败' });
    }
  },

  saveSchedules: async (schedules: ScheduleRecord[]) => {
    try {
      const { currentBatchId } = get();
      if (!currentBatchId) return;
      
      await scheduleOperations.clearByBatchId(currentBatchId);
      await scheduleOperations.addMany(schedules);
      
      set({ schedules });
      await get().updateBatchStats(currentBatchId, { totalSchedules: schedules.length });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存排班数据失败' });
    }
  },

  savePunches: async (punches: PunchRecord[]) => {
    try {
      const { currentBatchId } = get();
      if (!currentBatchId) return;
      
      await punchOperations.clearByBatchId(currentBatchId);
      await punchOperations.addMany(punches);
      
      set({ punches });
      await get().updateBatchStats(currentBatchId, { totalPunches: punches.length });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存打卡数据失败' });
    }
  },

  saveLeaves: async (leaves: LeaveRecord[]) => {
    try {
      const { currentBatchId } = get();
      if (!currentBatchId) return;
      
      await leaveOperations.clearByBatchId(currentBatchId);
      await leaveOperations.addMany(leaves);
      
      set({ leaves });
      await get().updateBatchStats(currentBatchId, { totalLeaves: leaves.length });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存调休数据失败' });
    }
  },

  saveMatchedRecords: async (records: MatchedRecord[]) => {
    try {
      const { currentBatchId } = get();
      if (!currentBatchId) return;
      
      await matchedRecordOperations.clearByBatchId(currentBatchId);
      await matchedRecordOperations.addMany(records);
      
      set({ matchedRecords: records });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存匹配数据失败' });
    }
  },

  saveAnomalies: async (anomalies: Anomaly[]) => {
    try {
      const { currentBatchId } = get();
      if (!currentBatchId) return;
      
      await anomalyOperations.clearByBatchId(currentBatchId);
      await anomalyOperations.addMany(anomalies);
      
      set({ anomalies });
      
      const pendingCount = anomalies.filter(a => a.status === 'pending').length;
      const correctedCount = anomalies.filter(a => a.status === 'corrected' || a.status === 'ignored' || a.status === 'confirmed').length;
      
      await get().updateBatchStats(currentBatchId, {
        totalAnomalies: anomalies.length,
        pendingAnomalies: pendingCount,
        correctedAnomalies: correctedCount,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存异常数据失败' });
    }
  },

  updateAnomaly: async (anomaly: Anomaly) => {
    try {
      await anomalyOperations.update(anomaly);
      set(state => ({
        anomalies: state.anomalies.map(a => a.id === anomaly.id ? anomaly : a),
      }));
      
      const { anomalies } = get();
      const pendingCount = anomalies.filter(a => a.status === 'pending').length;
      const correctedCount = anomalies.filter(a => a.status === 'corrected' || a.status === 'ignored' || a.status === 'confirmed').length;
      
      if (get().currentBatchId) {
        await get().updateBatchStats(get().currentBatchId!, {
          totalAnomalies: anomalies.length,
          pendingAnomalies: pendingCount,
          correctedAnomalies: correctedCount,
        });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '更新异常失败' });
    }
  },

  updateAnomalies: async (anomalies: Anomaly[]) => {
    try {
      await anomalyOperations.updateMany(anomalies);
      set(state => {
        const updatedMap = new Map(anomalies.map(a => [a.id, a]));
        return {
          anomalies: state.anomalies.map(a => updatedMap.get(a.id) || a),
        };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '批量更新异常失败' });
    }
  },

  addCorrection: async (correction: Correction) => {
    try {
      set(state => ({
        corrections: state.corrections.some(c => c.id === correction.id)
          ? state.corrections
          : [...state.corrections, correction],
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存修正记录失败' });
    }
  },

  revertCorrection: async (correctionId: string): Promise<boolean> => {
    try {
      const success = await revertCorrection(correctionId);
      if (success) {
        const currentBatchId = get().currentBatchId;
        if (currentBatchId) {
          const [anomalies, corrections] = await Promise.all([
            anomalyOperations.getByBatchId(currentBatchId),
            correctionOperations.getByBatchId(currentBatchId),
          ]);
          set({ anomalies, corrections });

          const pendingCount = anomalies.filter(a => a.status === 'pending').length;
          const correctedCount = anomalies.filter(a => 
            a.status === 'corrected' || a.status === 'ignored' || a.status === 'confirmed'
          ).length;

          await get().updateBatchStats(currentBatchId, {
            totalAnomalies: anomalies.length,
            pendingAnomalies: pendingCount,
            correctedAnomalies: correctedCount,
          });
        }
      }
      return success;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '撤回修正失败' });
      return false;
    }
  },

  loadRuleVersions: async () => {
    try {
      const versions = await ruleVersionOperations.getAll();
      const active = versions.find(v => v.isActive) || versions[versions.length - 1];
      set({ 
        ruleVersions: versions.sort((a, b) => b.version - a.version),
        activeRuleVersion: active || null,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载规则版本失败' });
    }
  },

  setActiveRuleVersion: async (versionId: string) => {
    try {
      await ruleVersionOperations.setActive(versionId);
      await get().loadRuleVersions();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '激活规则版本失败' });
    }
  },

  updateBatchStats: async (batchId: string, stats: Partial<BatchStats>) => {
    try {
      const batch = await batchOperations.getById(batchId);
      if (batch) {
        const updatedBatch: Batch = {
          ...batch,
          stats: { ...batch.stats, ...stats },
          updatedAt: new Date(),
        };
        await batchOperations.update(updatedBatch);
        await get().loadBatches();
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '更新批次统计失败' });
    }
  },

  updateFieldMapping: async (batchId: string, mapping: FieldMapping) => {
    try {
      const batch = await batchOperations.getById(batchId);
      if (batch) {
        const updatedBatch: Batch = {
          ...batch,
          fieldMapping: mapping,
          updatedAt: new Date(),
        };
        await batchOperations.update(updatedBatch);
        await get().loadBatches();
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '更新字段映射失败' });
    }
  },

  clearCurrentBatchData: () => {
    set({
      currentBatchId: null,
      schedules: [],
      punches: [],
      leaves: [],
      anomalies: [],
      matchedRecords: [],
      corrections: [],
      appeals: [],
    });
  },

  setError: (error: string | null) => set({ error }),
  setLoading: (loading: boolean) => set({ loading }),

  getCurrentBatch: () => {
    const state = get();
    return state.batches.find(b => b.id === state.currentBatchId);
  },

  analyzeAnomalies: async () => {
    const state = get();
    if (!state.currentBatchId) return;

    try {
      const { matchedRecords, activeRuleVersion, schedules, punches, leaves } = state;
      
      if (matchedRecords.length === 0 || !activeRuleVersion) return;

      const rulesModule = await import('../modules/rules');
      const result = await rulesModule.runAnomalyDetection(
        matchedRecords,
        activeRuleVersion.id
      );

      await get().saveAnomalies(result.anomalies);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '异常分析失败' });
    }
  },

  loadAuditLogs: async (batchId: string) => {
    try {
      const logs = await getBatchAuditTimeline(batchId);
      set({ auditLogs: logs });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载审计日志失败' });
    }
  },

  loadExportSnapshots: async (batchId: string) => {
    try {
      const snapshots = await getExportSnapshots(batchId);
      set({ exportSnapshots: snapshots });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载导出快照失败' });
    }
  },

  recordAuditLog: async (params) => {
    return createAuditLog(params);
  },

  getCurrentStatsSnapshot: () => {
    const state = get();
    const currentBatch = state.batches.find(b => b.id === state.currentBatchId);
    const batchStats = currentBatch?.stats || {
      totalSchedules: 0,
      totalPunches: 0,
      totalLeaves: 0,
      totalAnomalies: 0,
      pendingAnomalies: 0,
      correctedAnomalies: 0,
    };
    return createStatsSnapshot(batchStats, state.anomalies);
  },

  createExportSnapshot: async (format: string, includeAuditSummary: boolean) => {
    const state = get();
    if (!state.currentBatchId) {
      throw new Error('未选择批次');
    }

    const currentBatch = state.batches.find(b => b.id === state.currentBatchId);
    if (!currentBatch) {
      throw new Error('批次不存在');
    }

    const snapshot = await createExportSnapshot(
      state.currentBatchId,
      format,
      includeAuditSummary,
      state.anomalies,
      state.corrections,
      currentBatch.stats,
      currentBatch.statsVersion,
      state.auditLogs.length
    );

    await get().loadExportSnapshots(state.currentBatchId);
    return snapshot;
  },

  checkRestoreConflicts: async (snapshotId: string) => {
    return checkRestoreConflicts(snapshotId);
  },

  restoreToSnapshot: async (snapshotId: string, force: boolean = false) => {
    const result = await restoreToSnapshot(snapshotId, force);
    if (result.success) {
      const state = get();
      if (state.currentBatchId) {
        await get().selectBatch(state.currentBatchId);
        await get().loadAuditLogs(state.currentBatchId);
        await get().loadExportSnapshots(state.currentBatchId);
        await get().loadBatches();
      }
    }
    return result;
  },

  incrementStatsVersion: async (batchId: string) => {
    const currentVersion = await auditLogOperations.getLatestStatsVersion(batchId);
    const newVersion = currentVersion + 1;
    const batch = await batchOperations.getById(batchId);
    if (batch) {
      batch.statsVersion = newVersion;
      await batchOperations.update(batch);
      await get().loadBatches();
    }
    return newVersion;
  },

  loadPresets: async (type?: PresetType) => {
    try {
      const presets = await getPresets(type);
      set({ presets });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载预设失败' });
    }
  },

  saveImportPreset: async (params) => {
    const result = await savePreset({
      name: params.name,
      description: params.description,
      type: 'import',
      config: params.config,
      operator: params.operator,
    }, params.overwrite);

    if (result.success && result.preset) {
      await get().loadPresets();
      const action = params.overwrite ? 'preset_overwrite' : 'preset_save';
      await get().recordPresetAuditLog({
        action,
        preset: result.preset,
        operator: params.operator,
        success: true,
        metadata: { config: generatePresetSummary(result.preset) },
      });
    }

    return result;
  },

  saveExportPreset: async (params) => {
    const result = await savePreset({
      name: params.name,
      description: params.description,
      type: 'export',
      config: params.config,
      operator: params.operator,
    }, params.overwrite);

    if (result.success && result.preset) {
      await get().loadPresets();
      const action = params.overwrite ? 'preset_overwrite' : 'preset_save';
      await get().recordPresetAuditLog({
        action,
        preset: result.preset,
        operator: params.operator,
        success: true,
        metadata: { config: generatePresetSummary(result.preset) },
      });
    }

    return result;
  },

  updatePreset: async (params) => {
    const oldPreset = await getPresetById(params.id);
    const result = await updatePreset(params);
    
    if (result) {
      await get().loadPresets();
      await get().recordPresetAuditLog({
        action: 'preset_rename',
        preset: result,
        operator: params.operator,
        success: true,
        oldPreset,
        metadata: {
          oldConfig: oldPreset ? generatePresetSummary(oldPreset) : undefined,
          newConfig: generatePresetSummary(result),
        },
      });
    }
    
    return result;
  },

  renamePreset: async (presetId: string, newName: string, operator?: string) => {
    return get().updatePreset({ id: presetId, name: newName, operator });
  },

  duplicatePreset: async (presetId: string, newName: string, operator?: string) => {
    const oldPreset = await getPresetById(presetId);
    const result = await duplicatePreset(presetId, newName, operator);
    
    if (result) {
      await get().loadPresets();
      await get().recordPresetAuditLog({
        action: 'preset_duplicate',
        preset: result,
        operator,
        success: true,
        metadata: {
          duplicatedFrom: presetId,
          oldName: oldPreset?.name,
          newName: result.name,
          config: generatePresetSummary(result),
        },
      });
    }
    
    return result;
  },

  deletePreset: async (presetId: string, operator?: string) => {
    const preset = await getPresetById(presetId);
    if (!preset) return false;

    const result = await deletePreset(presetId);
    
    if (result) {
      await get().loadPresets();
      await get().recordPresetAuditLog({
        action: 'preset_delete',
        preset,
        operator,
        success: true,
        metadata: {
          deletedConfig: generatePresetSummary(preset),
        },
      });
    }
    
    return result;
  },

  applyPreset: async (presetId: string, force: boolean = false, operator?: string) => {
    const result = await applyPreset(presetId);
    
    if (result.success && result.preset) {
      await get().recordPresetAuditLog({
        action: 'preset_apply',
        preset: result.preset,
        operator,
        success: true,
        metadata: {
          config: generatePresetSummary(result.preset),
          force,
          conflicts: result.conflicts,
        },
      });
    } else if (result.requiresConfirmation && force && result.preset) {
      await get().recordPresetAuditLog({
        action: 'preset_apply',
        preset: result.preset,
        operator,
        success: true,
        metadata: {
          config: generatePresetSummary(result.preset),
          force: true,
          conflicts: result.conflicts,
        },
      });
      return { ...result, success: true };
    }
    
    return result;
  },

  exportPresetsToJSON: async (presetIds?: string[]) => {
    const result = await exportPresetsToJSON(presetIds);
    
    await get().recordPresetAuditLog({
      action: 'preset_export',
      preset: result.presets[0] || { id: 'batch-export', name: '导出预设', type: 'import', config: {} as ImportPresetConfig, version: 1, schemaVersion: 1, createdAt: new Date(), updatedAt: new Date(), createdBy: 'system', metadata: {} },
      success: true,
      metadata: {
        exportCount: result.presets.length,
        presetIds,
      },
    });
    
    return result;
  },

  importPresetsFromJSON: async (jsonData: any, operator?: string) => {
    const result = await importPresetsFromJSON(jsonData, operator);
    
    if (result.imported.length > 0) {
      await get().loadPresets();
    }
    
    for (const preset of result.imported) {
      await get().recordPresetAuditLog({
        action: 'preset_import',
        preset,
        operator,
        success: true,
        metadata: {
          config: generatePresetSummary(preset),
          importedFrom: preset.metadata?.importedFrom,
        },
      });
    }
    
    return result;
  },

  forceImportPreset: async (presetData: Preset, overwrite: boolean, operator?: string) => {
    const result = await forceImportPreset(presetData, overwrite, operator);
    
    if (result) {
      await get().loadPresets();
      await get().recordPresetAuditLog({
        action: 'preset_import',
        preset: result,
        operator,
        success: true,
        metadata: {
          overwrite,
          config: generatePresetSummary(result),
          originalName: presetData.name,
        },
      });
    }
    
    return result;
  },

  recordPresetAuditLog: async (params) => {
    const state = get();
    const emptyStats = createStatsSnapshot(undefined, []);
    
    return createAuditLog({
      batchId: params.batchId || state.currentBatchId || 'global',
      action: params.action,
      operator: params.operator || 'user',
      description: `预设${params.action === 'preset_save' ? '保存' : params.action === 'preset_apply' ? '套用' : params.action === 'preset_overwrite' ? '覆盖' : params.action === 'preset_rename' ? '重命名' : params.action === 'preset_delete' ? '删除' : params.action === 'preset_duplicate' ? '复制' : params.action === 'preset_import' ? '导入' : '导出'}：${params.preset.name}`,
      success: params.success,
      errorMessage: params.errorMessage,
      statsBefore: emptyStats,
      statsAfter: emptyStats,
      metadata: {
        presetId: params.preset.id,
        presetType: params.preset.type,
        presetVersion: params.preset.version,
        oldConfig: params.oldPreset ? generatePresetSummary(params.oldPreset) : undefined,
        newConfig: generatePresetSummary(params.preset),
        ...params.metadata,
      },
      linkedEntityIds: {},
    });
  },

  loadAppeals: async (batchId: string, status?: AppealStatus) => {
    try {
      const appeals = await getAppealsByBatchId(batchId, status);
      set({ appeals: appeals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载申诉记录失败' });
    }
  },

  checkAppealConflicts: async (anomalyId: string) => {
    return checkConflicts(anomalyId);
  },

  createAppeal: async (params: AppealCreateParams) => {
    const state = get();
    const currentBatch = state.getCurrentBatch();
    const statsBefore = state.getCurrentStatsSnapshot();
    let success = false;
    let errorMessage: string | undefined;

    const result = await createAppeal(params);

    if (result.success && result.appeal) {
      set(state => ({
        appeals: [result.appeal!, ...state.appeals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      }));
      success = true;

      await get().recordAppealAuditLog({
        batchId: result.appeal.batchId,
        action: 'appeal_create',
        appeal: result.appeal,
        operator: params.operator,
        success: true,
        metadata: {
          anomalyId: params.anomalyId,
          reason: params.reason,
          correctionType: params.correctionType,
          evidenceCount: params.evidence?.length || 0,
        },
      });
    } else if (result.conflicts && result.conflicts.length > 0) {
      errorMessage = result.conflicts.map(c => c.message).join('; ');
    } else {
      errorMessage = '创建申诉失败';
    }

    if (!success) {
      const batchId = currentBatch?.id || (await anomalyOperations.getById(params.anomalyId))?.batchId;
      if (batchId) {
        await get().recordAppealAuditLog({
          batchId,
          action: 'appeal_create',
          appeal: {} as Appeal,
          operator: params.operator,
          success: false,
          errorMessage,
          metadata: {
            anomalyId: params.anomalyId,
            reason: params.reason,
            conflicts: result.conflicts,
          },
        });
      }
    }

    return result;
  },

  approveAppeal: async (params: AppealReviewParams) => {
    const state = get();
    let success = false;
    let errorMessage: string | undefined;

    const result = await approveAppeal(params);

    if (result.success && result.appeal) {
      set(storeState => ({
        appeals: storeState.appeals.map(a => a.id === result.appeal!.id ? result.appeal! : a),
      }));

      if (result.correction) {
        await state.addCorrection(result.correction);
        await state.loadAppeals(result.appeal.batchId);

        const currentBatchId = state.currentBatchId;
        if (currentBatchId === result.appeal.batchId) {
          const [anomalies, corrections] = await Promise.all([
            anomalyOperations.getByBatchId(currentBatchId),
            correctionOperations.getByBatchId(currentBatchId),
          ]);
          set({ anomalies, corrections });

          const pendingCount = anomalies.filter(a => a.status === 'pending').length;
          const correctedCount = anomalies.filter(a => 
            a.status === 'corrected' || a.status === 'ignored' || a.status === 'confirmed'
          ).length;

          await state.updateBatchStats(currentBatchId, {
            totalAnomalies: anomalies.length,
            pendingAnomalies: pendingCount,
            correctedAnomalies: correctedCount,
          });
        }

        await get().recordAppealAuditLog({
          batchId: result.appeal.batchId,
          action: 'appeal_auto_correct',
          appeal: result.appeal,
          operator: params.operator,
          success: true,
          metadata: {
            correctionId: result.correction.id,
            correctionType: result.correction.type,
            anomalyId: result.appeal.anomalyId,
          },
        });
      }

      success = true;

      await get().recordAppealAuditLog({
        batchId: result.appeal.batchId,
        action: 'appeal_approve',
        appeal: result.appeal,
        operator: params.operator,
        success: true,
        metadata: {
          comment: params.comment,
          anomalyId: result.appeal.anomalyId,
          correctionId: result.correction?.id,
        },
      });
    } else if (result.conflicts && result.conflicts.length > 0) {
      errorMessage = result.conflicts.map(c => c.message).join('; ');
    } else {
      errorMessage = '审批申诉失败';
    }

    if (!success) {
      const appeal = await appealOperations.getById(params.appealId);
      if (appeal) {
        await get().recordAppealAuditLog({
          batchId: appeal.batchId,
          action: 'appeal_approve',
          appeal,
          operator: params.operator,
          success: false,
          errorMessage,
          metadata: {
            comment: params.comment,
            conflicts: result.conflicts,
          },
        });
      }
    }

    return result;
  },

  rejectAppeal: async (params: AppealReviewParams) => {
    const state = get();
    let success = false;
    let errorMessage: string | undefined;

    const result = await rejectAppeal(params);

    if (result.success && result.appeal) {
      set(storeState => ({
        appeals: storeState.appeals.map(a => a.id === result.appeal!.id ? result.appeal! : a),
      }));
      success = true;

      await get().recordAppealAuditLog({
        batchId: result.appeal.batchId,
        action: 'appeal_reject',
        appeal: result.appeal,
        operator: params.operator,
        success: true,
        metadata: {
          comment: params.comment,
          anomalyId: result.appeal.anomalyId,
        },
      });
    } else if (result.conflicts && result.conflicts.length > 0) {
      errorMessage = result.conflicts.map(c => c.message).join('; ');
    } else {
      errorMessage = '驳回申诉失败';
    }

    if (!success) {
      const appeal = await appealOperations.getById(params.appealId);
      if (appeal) {
        await get().recordAppealAuditLog({
          batchId: appeal.batchId,
          action: 'appeal_reject',
          appeal,
          operator: params.operator,
          success: false,
          errorMessage,
          metadata: {
            comment: params.comment,
            conflicts: result.conflicts,
          },
        });
      }
    }

    return result;
  },

  revokeAppeal: async (appealId: string, operator?: string) => {
    const state = get();
    let success = false;
    let errorMessage: string | undefined;

    const result = await revokeAppeal(appealId, operator);

    if (result.success && result.appeal) {
      set(storeState => ({
        appeals: storeState.appeals.map(a => a.id === result.appeal!.id ? result.appeal! : a),
      }));
      success = true;

      await get().recordAppealAuditLog({
        batchId: result.appeal.batchId,
        action: 'appeal_revoke',
        appeal: result.appeal,
        operator,
        success: true,
        metadata: {
          anomalyId: result.appeal.anomalyId,
        },
      });
    } else if (result.conflicts && result.conflicts.length > 0) {
      errorMessage = result.conflicts.map(c => c.message).join('; ');
    } else {
      errorMessage = '撤销申诉失败';
    }

    if (!success) {
      const appeal = await appealOperations.getById(appealId);
      if (appeal) {
        await get().recordAppealAuditLog({
          batchId: appeal.batchId,
          action: 'appeal_revoke',
          appeal,
          operator,
          success: false,
          errorMessage,
          metadata: {
            conflicts: result.conflicts,
          },
        });
      }
    }

    return result;
  },

  recordAppealAuditLog: async (params) => {
    const state = get();
    const currentBatch = state.batches.find(b => b.id === params.batchId);
    const statsBefore = createStatsSnapshot(currentBatch?.stats, state.anomalies);

    const actionDescriptions: Record<string, string> = {
      appeal_create: '发起申诉',
      appeal_approve: '通过申诉',
      appeal_reject: '驳回申诉',
      appeal_revoke: '撤销申诉',
      appeal_auto_correct: '申诉自动修正',
    };

    return createAuditLog({
      batchId: params.batchId,
      action: params.action,
      operator: params.operator || 'user',
      description: `${actionDescriptions[params.action] || params.action}：${params.appeal.employeeName || params.appeal.employeeId} - ${params.appeal.anomalyDescription.slice(0, 50)}`,
      success: params.success,
      errorMessage: params.errorMessage,
      statsBefore,
      statsAfter: statsBefore,
      metadata: {
        appealId: params.appeal.id,
        anomalyId: params.appeal.anomalyId,
        statusBefore: params.appeal.metadata?.stateTransition?.statusBefore,
        statusAfter: params.appeal.metadata?.stateTransition?.statusAfter,
        ...params.metadata,
      },
      linkedEntityIds: {
        anomalyIds: [params.appeal.anomalyId],
      },
    });
  },

  loadSimulators: async (sourceBatchId?: string) => {
    try {
      const simulators = await getSimulators(sourceBatchId);
      set({ simulators });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载模拟方案失败' });
    }
  },

  createSimulator: async (params) => {
    const result = await createSimulator(params);

    if (result.success && result.simulator) {
      await get().loadSimulators(params.sourceBatchId);
    }

    return result;
  },

  selectSimulator: (simulatorId: string | null) => {
    set({ currentSimulatorId: simulatorId });
  },

  updateSimulator: async (params) => {
    const result = await updateSimulator(params);

    if (result) {
      await get().loadSimulators(result.sourceBatchId);
    }

    return result;
  },

  runSimulation: async (simulatorId: string) => {
    try {
      set({ loading: true });
      const result = await runSimulation(simulatorId);

      if (result) {
        await get().loadSimulators(result.simulator.sourceBatchId);
      }

      set({ loading: false });
      return result;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '模拟运行失败', loading: false });
      return null;
    }
  },

  duplicateSimulator: async (simulatorId: string, newName: string, operator?: string) => {
    const result = await duplicateSimulator(simulatorId, newName, operator);

    if (result) {
      await get().loadSimulators(result.sourceBatchId);
    }

    return result;
  },

  deleteSimulator: async (simulatorId: string, operator?: string) => {
    const simulator = await getSimulatorById(simulatorId);
    const result = await deleteSimulator(simulatorId, operator);

    if (result && simulator) {
      await get().loadSimulators(simulator.sourceBatchId);

      await get().recordSimulatorAuditLog({
        batchId: simulator.sourceBatchId,
        action: 'simulator_delete',
        simulator,
        operator,
        success: true,
        metadata: {
          deletedConfig: generateSimulatorSummary(simulator),
        },
      });
    }

    return result;
  },

  saveSimulatorDraft: async (simulator: Simulator, overwrite: boolean = false, operator?: string) => {
    const result = await saveSimulatorDraft(simulator, overwrite, operator);

    if (result.success && result.simulator) {
      await get().loadSimulators(result.simulator.sourceBatchId);

      await get().recordSimulatorAuditLog({
        batchId: result.simulator.sourceBatchId,
        action: 'simulator_save',
        simulator: result.simulator,
        operator,
        success: true,
        metadata: {
          config: generateSimulatorSummary(result.simulator),
        },
      });
    }

    return result;
  },

  applySimulator: async (simulatorId: string, force: boolean = false, operator?: string) => {
    const result = await applySimulator(simulatorId, force, operator);

    if (result.success && result.simulator) {
      await get().loadSimulators(result.simulator.sourceBatchId);
      await get().loadRuleVersions();
    }

    return result;
  },

  revertSimulator: async (simulatorId: string, operator?: string) => {
    const result = await revertSimulator(simulatorId, operator);

    if (result.success && result.simulator) {
      await get().loadSimulators(result.simulator.sourceBatchId);
      await get().loadRuleVersions();
    }

    return result;
  },

  checkSimulatorConflicts: async (simulatorId: string) => {
    return checkSimulatorConflicts(simulatorId);
  },

  checkSimulatorPermission: (simulator: Simulator, user: string, required: 'readonly' | 'admin') => {
    return checkSimulatorPermission(simulator, user, required);
  },

  exportSimulatorsToJSON: async (simulatorIds?: string[], operator?: string) => {
    const result = await exportSimulatorsToJSON(simulatorIds, operator);
    return result;
  },

  importSimulatorsFromJSON: async (jsonData: any, operator?: string) => {
    const result = await importSimulatorsFromJSON(jsonData, operator);

    if (result.imported.length > 0) {
      await get().loadSimulators();
    }

    return result;
  },

  forceImportSimulator: async (simData: Omit<Simulator, 'id'>, overwrite: boolean, operator?: string) => {
    const result = await forceImportSimulator(simData, overwrite, operator);

    if (result) {
      await get().loadSimulators(result.sourceBatchId);

      await get().recordSimulatorAuditLog({
        batchId: result.sourceBatchId,
        action: 'simulator_import',
        simulator: result,
        operator,
        success: true,
        metadata: {
          overwrite,
          config: generateSimulatorSummary(result),
          originalName: simData.name,
        },
      });
    }

    return result;
  },

  recordSimulatorAuditLog: async (params) => {
    const state = get();
    const emptyStats = createStatsSnapshot(undefined, []);

    const actionDescriptions: Record<string, string> = {
      simulator_create: '创建模拟方案',
      simulator_save: '保存模拟方案',
      simulator_update: '更新模拟方案',
      simulator_delete: '删除模拟方案',
      simulator_apply: '应用模拟方案',
      simulator_revert: '撤销模拟方案',
      simulator_import: '导入模拟方案',
      simulator_export: '导出模拟方案',
      simulator_duplicate: '复制模拟方案',
    };

    return createAuditLog({
      batchId: params.batchId,
      action: params.action,
      operator: params.operator || 'user',
      description: `${actionDescriptions[params.action] || params.action}：${params.simulator.name}`,
      success: params.success,
      errorMessage: params.errorMessage,
      statsBefore: emptyStats,
      statsAfter: emptyStats,
      metadata: {
        simulatorId: params.simulator.id,
        params: params.simulator.params,
        status: params.simulator.status,
        oldConfig: params.oldSimulator ? generateSimulatorSummary(params.oldSimulator) : undefined,
        newConfig: generateSimulatorSummary(params.simulator),
        ...params.metadata,
      },
      linkedEntityIds: {
        ruleVersionIds: params.simulator.appliedRuleVersionId
          ? [params.simulator.appliedRuleVersionId]
          : [],
      },
    });
  },
}));
