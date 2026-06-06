import type {
  Simulator,
  SimulatorCreateParams,
  SimulatorUpdateParams,
  SimulatorRuleParams,
  SimulatorDataSnapshot,
  SimulationResult,
  SimulationDiff,
  SimulationDiffItem,
  SimulatorConflict,
  SimulatorConflictType,
  SimulatorPermission,
  SimulatorApplyResult,
  SimulatorRevertResult,
  SimulatorImportData,
  SimulatorSaveResult,
  Anomaly,
  AnomalyType,
  RuleVersion,
  RuleConfig,
  MatchedRecord,
} from '../../types';
import { SIMULATOR_SCHEMA_VERSION } from '../../types';
import { generateId } from '../../utils/dateUtils';
import {
  simulatorOperations,
  batchOperations,
  scheduleOperations,
  punchOperations,
  leaveOperations,
  matchedRecordOperations,
  anomalyOperations,
  ruleVersionOperations,
} from '../../db';
import { runAnomalyDetection } from '../rules';
import { createAuditLog, createStatsSnapshot } from '../audit';

const SIMULATOR_RULE_VERSION_PREFIX = 'simulator-temp-';

const restoreDateObjects = (matchedRecords: MatchedRecord[]): MatchedRecord[] => {
  return matchedRecords.map(record => ({
    ...record,
    punches: record.punches.map(punch => ({
      ...punch,
      punchTime: punch.punchTime instanceof Date ? punch.punchTime : new Date(punch.punchTime),
    })),
    workStartTime: record.workStartTime ? (record.workStartTime instanceof Date ? record.workStartTime : new Date(record.workStartTime)) : undefined,
    workEndTime: record.workEndTime ? (record.workEndTime instanceof Date ? record.workEndTime : new Date(record.workEndTime)) : undefined,
  }));
};

export const DEFAULT_PARAMS: SimulatorRuleParams = {
  lateGracePeriodMinutes: 10,
  earlyLeaveThresholdMinutes: 180,
  crossDayMaxHours: 16,
  duplicatePunchWindowMinutes: 5,
};

export const extractParamsFromRules = (rules: RuleConfig[]): SimulatorRuleParams => {
  const params: SimulatorRuleParams = { ...DEFAULT_PARAMS };

  const lateRule = rules.find(r => r.anomalyType === 'late');
  if (lateRule) {
    params.lateGracePeriodMinutes = lateRule.params.gracePeriodMinutes ?? DEFAULT_PARAMS.lateGracePeriodMinutes;
  }

  const earlyLeaveRule = rules.find(r => r.anomalyType === 'early_leave');
  if (earlyLeaveRule) {
    params.earlyLeaveThresholdMinutes = earlyLeaveRule.params.thresholdMinutes ?? DEFAULT_PARAMS.earlyLeaveThresholdMinutes;
  }

  const crossDayRule = rules.find(r => r.anomalyType === 'cross_day');
  if (crossDayRule) {
    params.crossDayMaxHours = crossDayRule.params.maxCrossHours ?? DEFAULT_PARAMS.crossDayMaxHours;
  }

  const duplicateRule = rules.find(r => r.anomalyType === 'duplicate');
  if (duplicateRule) {
    params.duplicatePunchWindowMinutes = duplicateRule.params.thresholdMinutes ?? DEFAULT_PARAMS.duplicatePunchWindowMinutes;
  }

  return params;
};

export const applyParamsToRules = (rules: RuleConfig[], params: SimulatorRuleParams): RuleConfig[] => {
  return rules.map(rule => {
    const updated = { ...rule, params: { ...rule.params } };

    if (rule.anomalyType === 'late') {
      updated.params.gracePeriodMinutes = params.lateGracePeriodMinutes;
    } else if (rule.anomalyType === 'early_leave') {
      updated.params.thresholdMinutes = params.earlyLeaveThresholdMinutes;
    } else if (rule.anomalyType === 'cross_day') {
      updated.params.maxCrossHours = params.crossDayMaxHours;
    } else if (rule.anomalyType === 'duplicate') {
      updated.params.thresholdMinutes = params.duplicatePunchWindowMinutes;
    }

    return updated;
  });
};

export const createSimulator = async (
  params: SimulatorCreateParams
): Promise<SimulatorSaveResult> => {
  const { name, description, sourceBatchId, operator = 'user' } = params;

  const existing = await simulatorOperations.getByName(name, sourceBatchId);
  if (existing) {
    return {
      success: false,
      conflicts: [{
        type: 'name_exists',
        message: `该批次下已存在名为"${name}"的模拟方案`,
        severity: 'error',
        details: { existingId: existing.id, name },
        resolutionOptions: ['overwrite', 'rename', 'cancel'],
      }],
      requiresConfirmation: true,
    };
  }

  const batch = await batchOperations.getById(sourceBatchId);
  if (!batch) {
    throw new Error('批次不存在');
  }

  const [
    schedules,
    punches,
    leaves,
    matchedRecords,
    originalAnomalies,
    activeRuleVersion,
  ] = await Promise.all([
    scheduleOperations.getByBatchId(sourceBatchId),
    punchOperations.getByBatchId(sourceBatchId),
    leaveOperations.getByBatchId(sourceBatchId),
    matchedRecordOperations.getByBatchId(sourceBatchId),
    anomalyOperations.getByBatchId(sourceBatchId),
    ruleVersionOperations.getActive(),
  ]);

  if (!activeRuleVersion) {
    throw new Error('未找到激活的规则版本');
  }

  const dataSnapshot: SimulatorDataSnapshot = {
    schedules: JSON.parse(JSON.stringify(schedules)),
    punches: JSON.parse(JSON.stringify(punches)),
    leaves: JSON.parse(JSON.stringify(leaves)),
    matchedRecords: JSON.parse(JSON.stringify(matchedRecords)),
    originalAnomalies: JSON.parse(JSON.stringify(originalAnomalies)),
    originalRuleVersionId: activeRuleVersion.id,
    originalStatsVersion: batch.statsVersion || 0,
    batchStatsAtCopy: JSON.parse(JSON.stringify(batch.stats)),
  };

  const currentParams = extractParamsFromRules(activeRuleVersion.rules);

  const simulator: Simulator = {
    id: generateId(),
    name,
    description,
    sourceBatchId,
    sourceBatchName: batch.name,
    status: 'draft',
    params: currentParams,
    dataSnapshot,
    permissions: {
      owner: operator,
      viewers: [],
      editors: [],
    },
    createdBy: operator,
    createdAt: new Date(),
    updatedAt: new Date(),
    schemaVersion: SIMULATOR_SCHEMA_VERSION,
    metadata: {},
  };

  await simulatorOperations.add(simulator);

  const statsBefore = createStatsSnapshot(batch.stats, originalAnomalies);
  await createAuditLog({
    batchId: sourceBatchId,
    action: 'simulator_create',
    operator,
    description: `创建模拟方案：${name}`,
    success: true,
    statsBefore,
    statsAfter: statsBefore,
    metadata: {
      simulatorId: simulator.id,
      params: currentParams,
    },
    linkedEntityIds: {
      ruleVersionIds: [activeRuleVersion.id],
    },
  });

  return {
    success: true,
    simulator,
    requiresConfirmation: false,
  };
};

export const runSimulation = async (
  simulatorId: string
): Promise<{ simulator: Simulator; result: SimulationResult; diff: SimulationDiff }> => {
  const simulator = await simulatorOperations.getById(simulatorId);
  if (!simulator) {
    throw new Error('模拟方案不存在');
  }

  const activeVersion = await ruleVersionOperations.getById(simulator.dataSnapshot.originalRuleVersionId);
  if (!activeVersion) {
    throw new Error('原始规则版本不存在');
  }

  const modifiedRules = applyParamsToRules(activeVersion.rules, simulator.params);

  const tempRuleVersion: RuleVersion = {
    id: `${SIMULATOR_RULE_VERSION_PREFIX}${simulatorId}`,
    version: 0,
    name: `模拟临时规则 - ${simulator.name}`,
    description: '模拟计算使用的临时规则版本，不会持久化',
    rules: modifiedRules,
    isActive: false,
    createdAt: new Date(),
    createdBy: 'simulator',
  };

  await ruleVersionOperations.add(tempRuleVersion);

  const restoredMatchedRecords = restoreDateObjects(simulator.dataSnapshot.matchedRecords);

  const startTime = Date.now();
  const detectionResult = await runAnomalyDetection(
    restoredMatchedRecords,
    tempRuleVersion.id
  );

  const byType: Record<AnomalyType, number> = {
    late: 0,
    early_leave: 0,
    missing_punch: 0,
    missing_punch_in: 0,
    missing_punch_out: 0,
    cross_day: 0,
    duplicate: 0,
    leave_offset: 0,
    overtime: 0,
    timezone_error: 0,
    no_schedule: 0,
    no_punch: 0,
  };

  detectionResult.anomalies.forEach(a => {
    a.ruleVersionId = tempRuleVersion.id;
    if (byType[a.type] !== undefined) {
      byType[a.type]++;
    }
  });

  const result: SimulationResult = {
    anomalies: detectionResult.anomalies,
    summary: {
      byType,
      bySeverity: detectionResult.summary.bySeverity,
    },
    durationMs: Date.now() - startTime,
    ruleVersionId: tempRuleVersion.id,
  };

  const diff = calculateDiff(simulator.dataSnapshot.originalAnomalies, result.anomalies);

  const updatedSimulator: Simulator = {
    ...simulator,
    status: 'ready',
    simulationResult: result,
    simulationDiff: diff,
    updatedAt: new Date(),
  };

  await simulatorOperations.update(updatedSimulator);

  await ruleVersionOperations.delete(tempRuleVersion.id);

  return { simulator: updatedSimulator, result, diff };
};

export const calculateDiff = (
  original: Anomaly[],
  simulated: Anomaly[]
): SimulationDiff => {
  const originalMap = new Map(original.map(a => [a.id, a]));
  const simulatedMap = new Map(simulated.map(a => [a.id, a]));

  const items: SimulationDiffItem[] = [];
  const byType: Record<AnomalyType, number> = {
    late: 0,
    early_leave: 0,
    missing_punch: 0,
    missing_punch_in: 0,
    missing_punch_out: 0,
    cross_day: 0,
    duplicate: 0,
    leave_offset: 0,
    overtime: 0,
    timezone_error: 0,
    no_schedule: 0,
    no_punch: 0,
  };

  let totalAdded = 0;
  let totalRemoved = 0;
  let totalModified = 0;

  for (const sim of simulated) {
    const orig = originalMap.get(sim.id);
    if (!orig) {
      items.push({
        type: 'added',
        anomalyId: sim.id,
        simulated: sim,
      });
      totalAdded++;
      if (byType[sim.type] !== undefined) {
        byType[sim.type]++;
      }
    } else if (hasAnomalyChanged(orig, sim)) {
      items.push({
        type: 'modified',
        anomalyId: sim.id,
        original: orig,
        simulated: sim,
      });
      totalModified++;
      if (byType[sim.type] !== undefined) {
        byType[sim.type]++;
      }
    }
  }

  for (const orig of original) {
    if (!simulatedMap.has(orig.id)) {
      items.push({
        type: 'removed',
        anomalyId: orig.id,
        original: orig,
      });
      totalRemoved++;
      if (byType[orig.type] !== undefined) {
        byType[orig.type]--;
      }
    }
  }

  return {
    items,
    summary: {
      totalAdded,
      totalRemoved,
      totalModified,
      netChange: totalAdded - totalRemoved,
      byType,
    },
  };
};

const hasAnomalyChanged = (a: Anomaly, b: Anomaly): boolean => {
  return (
    a.type !== b.type ||
    a.severity !== b.severity ||
    a.status !== b.status ||
    a.durationMinutes !== b.durationMinutes ||
    a.description !== b.description
  );
};

export const checkConflicts = async (
  simulatorId: string
): Promise<SimulatorConflict[]> => {
  const simulator = await simulatorOperations.getById(simulatorId);
  if (!simulator) {
    return [{
      type: 'batch_data_changed',
      message: '模拟方案不存在',
      severity: 'error',
      resolutionOptions: ['cancel'],
    }];
  }

  const conflicts: SimulatorConflict[] = [];

  const batch = await batchOperations.getById(simulator.sourceBatchId);
  if (!batch) {
    conflicts.push({
      type: 'batch_data_changed',
      message: '源批次已被删除',
      severity: 'error',
      resolutionOptions: ['cancel'],
      details: { sourceBatchId: simulator.sourceBatchId },
    });
    return conflicts;
  }

  if ((batch.statsVersion || 0) !== simulator.dataSnapshot.originalStatsVersion) {
    conflicts.push({
      type: 'stats_version_mismatch',
      message: `批次统计版本已变更：当前版本 ${batch.statsVersion}，快照版本 ${simulator.dataSnapshot.originalStatsVersion}`,
      severity: 'warning',
      resolutionOptions: ['reload', 'cancel'],
      details: {
        current: batch.statsVersion,
        snapshot: simulator.dataSnapshot.originalStatsVersion,
      },
    });
  }

  const currentAnomalies = await anomalyOperations.getByBatchId(simulator.sourceBatchId);
  if (currentAnomalies.length !== simulator.dataSnapshot.originalAnomalies.length) {
    conflicts.push({
      type: 'new_detection_results',
      message: `批次检测结果已变更：当前 ${currentAnomalies.length} 条异常，快照 ${simulator.dataSnapshot.originalAnomalies.length} 条`,
      severity: 'warning',
      resolutionOptions: ['reload', 'cancel'],
      details: {
        currentCount: currentAnomalies.length,
        snapshotCount: simulator.dataSnapshot.originalAnomalies.length,
      },
    });
  }

  const activeRuleVersion = await ruleVersionOperations.getActive();
  if (activeRuleVersion && activeRuleVersion.id !== simulator.dataSnapshot.originalRuleVersionId) {
    const isRollback = activeRuleVersion.name.includes('(回滚)');
    if (isRollback) {
      conflicts.push({
        type: 'rule_version_rolled_back',
        message: `规则版本已回滚：当前版本 "${activeRuleVersion.name}"，快照版本 ID ${simulator.dataSnapshot.originalRuleVersionId}`,
        severity: 'warning',
        resolutionOptions: ['reload', 'cancel'],
        details: {
          currentRuleVersionId: activeRuleVersion.id,
          currentRuleVersionName: activeRuleVersion.name,
          snapshotRuleVersionId: simulator.dataSnapshot.originalRuleVersionId,
        },
      });
    }
  }

  const appliedSimulators = await simulatorOperations.getByStatus('applied');
  const batchAppliedSim = appliedSimulators.find(s => s.sourceBatchId === simulator.sourceBatchId);
  if (batchAppliedSim && batchAppliedSim.id !== simulatorId) {
    conflicts.push({
      type: 'applied_simulator_exists',
      message: `该批次已有已应用的模拟方案："${batchAppliedSim.name}"`,
      severity: 'error',
      resolutionOptions: ['overwrite', 'cancel'],
      details: {
        appliedSimulatorId: batchAppliedSim.id,
        appliedSimulatorName: batchAppliedSim.name,
      },
    });
  }

  return conflicts;
};

export const checkPermission = (
  simulator: Simulator,
  user: string,
  required: SimulatorPermission
): boolean => {
  if (simulator.permissions.owner === user) {
    return true;
  }

  if (required === 'readonly') {
    return (
      simulator.permissions.viewers.includes(user) ||
      simulator.permissions.editors.includes(user)
    );
  }

  if (required === 'admin') {
    return simulator.permissions.editors.includes(user);
  }

  return false;
};

export const updateSimulator = async (
  params: SimulatorUpdateParams
): Promise<Simulator | null> => {
  const { id, name, description, params: ruleParams, operator = 'user' } = params;

  const simulator = await simulatorOperations.getById(id);
  if (!simulator) return null;

  if (!checkPermission(simulator, operator, 'admin')) {
    throw new Error('无编辑权限');
  }

  if (name && name !== simulator.name) {
    const existing = await simulatorOperations.getByName(name, simulator.sourceBatchId);
    if (existing && existing.id !== id) {
      throw new Error(`该批次下已存在名为"${name}"的模拟方案`);
    }
  }

  const updated: Simulator = {
    ...simulator,
    name: name ?? simulator.name,
    description: description ?? simulator.description,
    params: ruleParams ? { ...simulator.params, ...ruleParams } : simulator.params,
    updatedAt: new Date(),
    status: ruleParams ? 'draft' : simulator.status,
    simulationResult: ruleParams ? undefined : simulator.simulationResult,
    simulationDiff: ruleParams ? undefined : simulator.simulationDiff,
  };

  await simulatorOperations.update(updated);
  return updated;
};

export const duplicateSimulator = async (
  simulatorId: string,
  newName: string,
  operator: string = 'user'
): Promise<Simulator | null> => {
  const original = await simulatorOperations.getById(simulatorId);
  if (!original) return null;

  const existing = await simulatorOperations.getByName(newName, original.sourceBatchId);
  if (existing) {
    throw new Error(`该批次下已存在名为"${newName}"的模拟方案`);
  }

  const duplicate: Simulator = {
    ...JSON.parse(JSON.stringify(original)),
    id: generateId(),
    name: newName,
    status: 'draft',
    simulationResult: undefined,
    simulationDiff: undefined,
    appliedRuleVersionId: undefined,
    revertedFromRuleVersionId: undefined,
    appliedAt: undefined,
    appliedBy: undefined,
    revertedAt: undefined,
    revertedBy: undefined,
    permissions: {
      owner: operator,
      viewers: [],
      editors: [],
    },
    createdBy: operator,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {
      duplicatedFrom: simulatorId,
      originalName: original.name,
    },
  };

  await simulatorOperations.add(duplicate);
  return duplicate;
};

export const deleteSimulator = async (
  simulatorId: string,
  operator: string = 'user'
): Promise<boolean> => {
  const simulator = await simulatorOperations.getById(simulatorId);
  if (!simulator) return false;

  if (!checkPermission(simulator, operator, 'admin')) {
    throw new Error('无删除权限');
  }

  await simulatorOperations.delete(simulatorId);
  return true;
};

export const getSimulators = async (sourceBatchId?: string): Promise<Simulator[]> => {
  if (sourceBatchId) {
    return simulatorOperations.getBySourceBatchId(sourceBatchId);
  }
  return simulatorOperations.getAll();
};

export const getSimulatorById = async (id: string): Promise<Simulator | undefined> => {
  return simulatorOperations.getById(id);
};

export const saveSimulatorDraft = async (
  simulator: Simulator,
  overwrite: boolean = false,
  operator: string = 'user'
): Promise<SimulatorSaveResult> => {
  if (!checkPermission(simulator, operator, 'admin')) {
    return {
      success: false,
      conflicts: [{
        type: 'batch_data_changed',
        message: '无保存权限',
        severity: 'error',
        resolutionOptions: ['cancel'],
      }],
      requiresConfirmation: false,
    };
  }

  const existing = await simulatorOperations.getByName(simulator.name, simulator.sourceBatchId);
  if (existing && existing.id !== simulator.id && !overwrite) {
    return {
      success: false,
      conflicts: [{
        type: 'name_exists',
        message: `该批次下已存在名为"${simulator.name}"的模拟方案`,
        severity: 'error',
        details: { existingId: existing.id, name: simulator.name },
        resolutionOptions: ['overwrite', 'rename', 'cancel'],
      }],
      requiresConfirmation: true,
    };
  }

  const updated = { ...simulator, updatedAt: new Date() };
  await simulatorOperations.update(updated);

  return {
    success: true,
    simulator: updated,
    requiresConfirmation: false,
  };
};

export const applySimulator = async (
  simulatorId: string,
  force: boolean = false,
  operator: string = 'user'
): Promise<SimulatorApplyResult> => {
  const simulator = await simulatorOperations.getById(simulatorId);
  if (!simulator) {
    return {
      success: false,
      requiresConfirmation: false,
      conflicts: [{
        type: 'batch_data_changed',
        message: '模拟方案不存在',
        severity: 'error',
        resolutionOptions: ['cancel'],
      }],
    };
  }

  if (!checkPermission(simulator, operator, 'admin')) {
    return {
      success: false,
      requiresConfirmation: false,
      conflicts: [{
        type: 'batch_data_changed',
        message: '无应用权限',
        severity: 'error',
        resolutionOptions: ['cancel'],
      }],
    };
  }

  const conflicts = await checkConflicts(simulatorId);
  const errors = conflicts.filter(c => c.severity === 'error');

  if (!force && errors.length > 0) {
    return {
      success: false,
      conflicts,
      requiresConfirmation: true,
    };
  }

  if (force) {
    const appliedSimulators = await simulatorOperations.getByStatus('applied');
    const batchAppliedSim = appliedSimulators.find(
      s => s.sourceBatchId === simulator.sourceBatchId && s.id !== simulatorId
    );
    if (batchAppliedSim) {
      await revertSimulator(batchAppliedSim.id, operator);
    }
  }

  const originalRuleVersion = await ruleVersionOperations.getById(simulator.dataSnapshot.originalRuleVersionId);
  if (!originalRuleVersion) {
    return {
      success: false,
      requiresConfirmation: false,
      conflicts: [{
        type: 'rule_version_rolled_back',
        message: '原始规则版本不存在',
        severity: 'error',
        resolutionOptions: ['cancel'],
      }],
    };
  }

  const modifiedRules = applyParamsToRules(originalRuleVersion.rules, simulator.params);

  const maxVersion = await ruleVersionOperations.getMaxVersion();
  const newRuleVersion: RuleVersion = {
    id: generateId(),
    version: maxVersion + 1,
    name: `模拟方案：${simulator.name}`,
    description: `从模拟方案"${simulator.name}"应用生成的规则版本。参数：迟到宽限${simulator.params.lateGracePeriodMinutes}分钟，早退阈值${simulator.params.earlyLeaveThresholdMinutes}分钟，跨日班次${simulator.params.crossDayMaxHours}小时，重复打卡窗口${simulator.params.duplicatePunchWindowMinutes}分钟。`,
    rules: modifiedRules.map(r => ({ ...r, id: r.id || generateId() })),
    isActive: false,
    createdAt: new Date(),
    createdBy: operator,
  };

  await ruleVersionOperations.add(newRuleVersion);
  await ruleVersionOperations.setActive(newRuleVersion.id);

  const updatedSimulator: Simulator = {
    ...simulator,
    status: 'applied',
    appliedRuleVersionId: newRuleVersion.id,
    appliedAt: new Date(),
    appliedBy: operator,
    updatedAt: new Date(),
  };

  await simulatorOperations.update(updatedSimulator);

  const batch = await batchOperations.getById(simulator.sourceBatchId);
  const statsBefore = createStatsSnapshot(
    simulator.dataSnapshot.batchStatsAtCopy,
    simulator.dataSnapshot.originalAnomalies
  );
  const statsAfter = simulator.simulationResult
    ? createStatsSnapshot(
        { ...simulator.dataSnapshot.batchStatsAtCopy, totalAnomalies: simulator.simulationResult.anomalies.length },
        simulator.simulationResult.anomalies
      )
    : statsBefore;

  await createAuditLog({
    batchId: simulator.sourceBatchId,
    action: 'simulator_apply',
    operator,
    description: `应用模拟方案：${simulator.name}，生成规则版本 v${newRuleVersion.version}`,
    success: true,
    statsBefore,
    statsAfter,
    metadata: {
      simulatorId,
      params: simulator.params,
      ruleVersionId: newRuleVersion.id,
      ruleVersion: newRuleVersion.version,
      force,
      conflicts,
    },
    linkedEntityIds: {
      ruleVersionIds: [newRuleVersion.id, simulator.dataSnapshot.originalRuleVersionId],
    },
  });

  return {
    success: true,
    simulator: updatedSimulator,
    newRuleVersion,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    requiresConfirmation: false,
  };
};

export const revertSimulator = async (
  simulatorId: string,
  operator: string = 'user'
): Promise<SimulatorRevertResult> => {
  const simulator = await simulatorOperations.getById(simulatorId);
  if (!simulator) {
    return {
      success: false,
      message: '模拟方案不存在',
    };
  }

  if (simulator.status !== 'applied') {
    return {
      success: false,
      message: '该模拟方案未处于已应用状态',
    };
  }

  if (!checkPermission(simulator, operator, 'admin')) {
    return {
      success: false,
      message: '无撤销权限',
    };
  }

  if (!simulator.appliedRuleVersionId) {
    return {
      success: false,
      message: '未找到应用的规则版本',
    };
  }

  await ruleVersionOperations.setActive(simulator.dataSnapshot.originalRuleVersionId);

  const updatedSimulator: Simulator = {
    ...simulator,
    status: 'reverted',
    revertedFromRuleVersionId: simulator.appliedRuleVersionId,
    revertedAt: new Date(),
    revertedBy: operator,
    updatedAt: new Date(),
  };

  await simulatorOperations.update(updatedSimulator);

  const activeVersion = await ruleVersionOperations.getById(simulator.dataSnapshot.originalRuleVersionId);

  const batch = await batchOperations.getById(simulator.sourceBatchId);
  const statsBefore = createStatsSnapshot(
    batch?.stats,
    await anomalyOperations.getByBatchId(simulator.sourceBatchId)
  );

  await createAuditLog({
    batchId: simulator.sourceBatchId,
    action: 'simulator_revert',
    operator,
    description: `撤销模拟方案：${simulator.name}，恢复到规则版本 ${activeVersion?.name || simulator.dataSnapshot.originalRuleVersionId}`,
    success: true,
    statsBefore,
    statsAfter: statsBefore,
    metadata: {
      simulatorId,
      revertedFromRuleVersionId: simulator.appliedRuleVersionId,
      restoredRuleVersionId: simulator.dataSnapshot.originalRuleVersionId,
    },
    linkedEntityIds: {
      ruleVersionIds: [simulator.appliedRuleVersionId, simulator.dataSnapshot.originalRuleVersionId],
    },
  });

  return {
    success: true,
    simulator: updatedSimulator,
    revertedToRuleVersionId: simulator.dataSnapshot.originalRuleVersionId,
    message: `已成功撤销模拟方案，恢复到原始规则版本`,
  };
};

export const exportSimulatorsToJSON = async (
  simulatorIds?: string[],
  operator: string = 'user'
): Promise<{
  schemaVersion: number;
  exportedAt: Date;
  exportedBy: string;
  simulators: Omit<Simulator, 'id'>[];
}> => {
  let simulators: Simulator[];

  if (simulatorIds && simulatorIds.length > 0) {
    simulators = [];
    for (const id of simulatorIds) {
      const sim = await simulatorOperations.getById(id);
      if (sim) {
        simulators.push(sim);
      }
    }
  } else {
    simulators = await simulatorOperations.getAll();
  }

  const exportData = simulators.map(s => {
    const { id, ...rest } = s;
    return JSON.parse(JSON.stringify(rest));
  });

  const result = {
    schemaVersion: SIMULATOR_SCHEMA_VERSION,
    exportedAt: new Date(),
    exportedBy: operator,
    simulators: exportData,
  };

  if (simulators.length > 0) {
    const statsBefore = createStatsSnapshot(undefined, []);
    await createAuditLog({
      batchId: simulators[0].sourceBatchId,
      action: 'simulator_export',
      operator,
      description: `导出模拟方案：${simulators.map(s => s.name).join(', ')}`,
      success: true,
      statsBefore,
      statsAfter: statsBefore,
      metadata: {
        exportCount: simulators.length,
        simulatorId: simulators[0].id,
        simulatorIds: simulators.map(s => s.id),
      },
    });
  }

  return result;
};

export const importSimulatorsFromJSON = async (
  jsonData: any,
  operator: string = 'user'
): Promise<{
  imported: Simulator[];
  skipped: Array<{ data: Omit<Simulator, 'id'>; reason: string }>;
  conflicts: SimulatorConflict[];
}> => {
  const result: {
    imported: Simulator[];
    skipped: Array<{ data: Omit<Simulator, 'id'>; reason: string }>;
    conflicts: SimulatorConflict[];
  } = {
    imported: [],
    skipped: [],
    conflicts: [],
  };

  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error('导入数据格式错误');
  }

  if (jsonData.schemaVersion !== SIMULATOR_SCHEMA_VERSION) {
    result.conflicts.push({
      type: 'batch_data_changed',
      message: `schema版本不兼容：导入版本 ${jsonData.schemaVersion}，当前版本 ${SIMULATOR_SCHEMA_VERSION}`,
      severity: 'error',
      resolutionOptions: ['cancel'],
      details: {
        importVersion: jsonData.schemaVersion,
        currentVersion: SIMULATOR_SCHEMA_VERSION,
      },
    });
    return result;
  }

  const simulatorsData = jsonData.simulators || [];

  for (const simData of simulatorsData) {
    try {
      const existing = await simulatorOperations.getByName(simData.name, simData.sourceBatchId);
      if (existing) {
        result.conflicts.push({
          type: 'name_exists',
          message: `批次 ${simData.sourceBatchName} 下已存在名为"${simData.name}"的模拟方案`,
          severity: 'warning',
          resolutionOptions: ['overwrite', 'rename', 'cancel'],
          details: {
            existingId: existing.id,
            name: simData.name,
            sourceBatchId: simData.sourceBatchId,
          },
        });
        result.skipped.push({
          data: simData,
          reason: '名称冲突',
        });
        continue;
      }

      const batch = await batchOperations.getById(simData.sourceBatchId);
      if (!batch) {
        result.skipped.push({
          data: simData,
          reason: '源批次不存在',
        });
        continue;
      }

      const simulator: Simulator = {
        ...simData,
        id: generateId(),
        permissions: {
          owner: operator,
          viewers: [],
          editors: [],
        },
        createdBy: operator,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft',
        simulationResult: undefined,
        simulationDiff: undefined,
        appliedRuleVersionId: undefined,
        revertedFromRuleVersionId: undefined,
        appliedAt: undefined,
        appliedBy: undefined,
        revertedAt: undefined,
        revertedBy: undefined,
        metadata: {
          ...simData.metadata,
          importedFrom: jsonData.exportedBy,
          importedAt: new Date(),
        },
      };

      await simulatorOperations.add(simulator);
      result.imported.push(simulator);

      const statsBefore = createStatsSnapshot(batch.stats, []);
      await createAuditLog({
        batchId: simData.sourceBatchId,
        action: 'simulator_import',
        operator,
        description: `导入模拟方案：${simulator.name}`,
        success: true,
        statsBefore,
        statsAfter: statsBefore,
        metadata: {
          simulatorId: simulator.id,
          importedFrom: jsonData.exportedBy,
          exportedAt: jsonData.exportedAt,
        },
      });
    } catch (error) {
      result.skipped.push({
        data: simData,
        reason: error instanceof Error ? error.message : '未知错误',
      });
    }
  }

  return result;
};

export const forceImportSimulator = async (
  simData: Omit<Simulator, 'id'>,
  overwrite: boolean,
  operator: string = 'user'
): Promise<Simulator> => {
  const existing = await simulatorOperations.getByName(simData.name, simData.sourceBatchId);

  if (existing && overwrite) {
    const updated: Simulator = {
      ...existing,
      params: simData.params,
      dataSnapshot: simData.dataSnapshot,
      description: simData.description,
      updatedAt: new Date(),
      status: 'draft',
      simulationResult: undefined,
      simulationDiff: undefined,
      metadata: {
        ...existing.metadata,
        importedFrom: 'force-import',
      },
    };
    await simulatorOperations.update(updated);
    return updated;
  }

  if (existing && !overwrite) {
    const newName = `${simData.name} (导入)`;
    const simulator: Simulator = {
      ...simData,
      id: generateId(),
      name: newName,
      permissions: {
        owner: operator,
        viewers: [],
        editors: [],
      },
      createdBy: operator,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'draft',
      metadata: {
        ...simData.metadata,
        importedFrom: 'force-import',
        originalName: simData.name,
      },
    };
    await simulatorOperations.add(simulator);
    return simulator;
  }

  const simulator: Simulator = {
    ...simData,
    id: generateId(),
    permissions: {
      owner: operator,
      viewers: [],
      editors: [],
    },
    createdBy: operator,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'draft',
    metadata: {
      ...simData.metadata,
      importedFrom: 'force-import',
    },
  };
  await simulatorOperations.add(simulator);
  return simulator;
};

export const generateSimulatorSummary = (simulator: Simulator): Record<string, any> => {
  return {
    name: simulator.name,
    status: simulator.status,
    sourceBatchName: simulator.sourceBatchName,
    params: simulator.params,
    originalAnomalies: simulator.dataSnapshot.originalAnomalies.length,
    simulatedAnomalies: simulator.simulationResult?.anomalies.length,
    diff: simulator.simulationDiff?.summary,
    createdAt: simulator.createdAt,
    createdBy: simulator.createdBy,
  };
};

export const simulatorModule = {
  DEFAULT_PARAMS,
  extractParamsFromRules,
  applyParamsToRules,
  createSimulator,
  runSimulation,
  calculateDiff,
  checkConflicts,
  checkPermission,
  updateSimulator,
  duplicateSimulator,
  deleteSimulator,
  getSimulators,
  getSimulatorById,
  saveSimulatorDraft,
  applySimulator,
  revertSimulator,
  exportSimulatorsToJSON,
  importSimulatorsFromJSON,
  forceImportSimulator,
  generateSimulatorSummary,
};

export default simulatorModule;
