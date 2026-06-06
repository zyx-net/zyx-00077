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
} from '../db';
import { initializeRuleVersions } from '../modules/rules';
import { revertCorrection } from '../modules/correction';

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
  loading: boolean;
  error: string | null;
  
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
  loading: false,
  error: null,

  initApp: async () => {
    try {
      set({ loading: true });
      await initializeRuleVersions();
      await get().loadBatches();
      await get().loadRuleVersions();
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
    };
    
    await batchOperations.add(batch);
    await get().loadBatches();
    return batch;
  },

  selectBatch: async (batchId: string) => {
    try {
      set({ loading: true, currentBatchId: batchId });
      
      const [schedules, punches, leaves, anomalies, corrections, matchedRecords] = await Promise.all([
        scheduleOperations.getByBatchId(batchId),
        punchOperations.getByBatchId(batchId),
        leaveOperations.getByBatchId(batchId),
        anomalyOperations.getByBatchId(batchId),
        correctionOperations.getByBatchId(batchId),
        matchedRecordOperations.getByBatchId(batchId),
      ]);
      
      set({
        schedules,
        punches,
        leaves,
        anomalies,
        corrections,
        matchedRecords,
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
    });
  },

  setError: (error: string | null) => set({ error }),
  setLoading: (loading: boolean) => set({ loading }),
}));
