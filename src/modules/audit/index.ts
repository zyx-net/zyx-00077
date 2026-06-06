import type {
  AuditLogEntry,
  AuditActionType,
  AuditStatsSnapshot,
  AuditExportSnapshot,
  RestoreCheckResult,
  BatchStats,
  Anomaly,
  Correction,
  Batch,
} from '../../types';
import { generateId } from '../../utils/dateUtils';
import {
  auditLogOperations,
  auditExportSnapshotOperations,
  batchOperations,
  anomalyOperations,
  correctionOperations,
} from '../../db';
import { calculateSummary } from '../stats';

const ACTION_LABELS: Record<AuditActionType, string> = {
  import: '导入数据',
  rule_switch: '切换规则版本',
  correction: '人工修正',
  revert_correction: '撤回修正',
  export: '导出报告',
  analyze: '分析异常',
  batch_create: '创建批次',
  batch_delete: '删除批次',
  restore: '恢复数据',
  preset_save: '保存预设',
  preset_apply: '套用预设',
  preset_overwrite: '覆盖预设',
  preset_rename: '重命名预设',
  preset_delete: '删除预设',
  preset_duplicate: '复制预设',
  preset_import: '导入预设',
  preset_export: '导出预设',
};

export const createStatsSnapshot = (
  batchStats: BatchStats | undefined,
  anomalies: Anomaly[] = []
): AuditStatsSnapshot => {
  const summary = anomalies.length > 0 ? calculateSummary(anomalies) : null;
  const safeStats = batchStats || {
    totalSchedules: 0,
    totalPunches: 0,
    totalLeaves: 0,
    totalAnomalies: 0,
    pendingAnomalies: 0,
    correctedAnomalies: 0,
  };
  
  return {
    totalSchedules: safeStats.totalSchedules,
    totalPunches: safeStats.totalPunches,
    totalLeaves: safeStats.totalLeaves,
    totalAnomalies: safeStats.totalAnomalies,
    pendingAnomalies: safeStats.pendingAnomalies,
    correctedAnomalies: safeStats.correctedAnomalies,
    byType: summary?.anomaliesByType,
    bySeverity: summary?.anomaliesBySeverity,
  };
};

export interface CreateAuditLogParams {
  batchId: string;
  action: AuditActionType;
  operator?: string;
  description: string;
  success: boolean;
  errorMessage?: string;
  statsBefore: AuditStatsSnapshot;
  statsAfter: AuditStatsSnapshot;
  metadata?: Record<string, any>;
  linkedEntityIds?: {
    anomalyIds?: string[];
    correctionIds?: string[];
    ruleVersionIds?: string[];
    exportId?: string;
  };
  statsVersion?: number;
}

export const createAuditLog = async (
  params: CreateAuditLogParams
): Promise<AuditLogEntry> => {
  let statsVersion: number;
  if (params.statsVersion !== undefined) {
    statsVersion = params.statsVersion;
  } else {
    const [latestLogVersion, batch] = await Promise.all([
      auditLogOperations.getLatestStatsVersion(params.batchId),
      batchOperations.getById(params.batchId),
    ]);
    const batchVersion = batch?.statsVersion || 0;
    statsVersion = Math.max(latestLogVersion, batchVersion) + 1;
  }

  const log: AuditLogEntry = {
    id: generateId(),
    batchId: params.batchId,
    action: params.action,
    operator: params.operator || 'user',
    timestamp: new Date(),
    description: params.description,
    success: params.success,
    errorMessage: params.errorMessage,
    statsBefore: params.statsBefore,
    statsAfter: params.statsAfter,
    metadata: params.metadata || {},
    linkedEntityIds: params.linkedEntityIds || {},
    statsVersion,
  };

  await auditLogOperations.add(log);
  
  if (params.success) {
    const batch = await batchOperations.getById(params.batchId);
    if (batch) {
      batch.statsVersion = statsVersion;
      batch.updatedAt = new Date();
      await batchOperations.update(batch);
    }
  }

  return log;
};

export const getBatchAuditTimeline = async (
  batchId: string
): Promise<AuditLogEntry[]> => {
  const logs = await auditLogOperations.getByBatchId(batchId);
  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

export const getBatchAuditTimelineByAction = async (
  batchId: string,
  action: AuditActionType
): Promise<AuditLogEntry[]> => {
  return auditLogOperations.getByBatchIdAndAction(batchId, action);
};

export const createExportSnapshot = async (
  batchId: string,
  format: string,
  includeAuditSummary: boolean,
  anomalies: Anomaly[],
  corrections: Correction[],
  batchStats: BatchStats,
  statsVersion: number,
  auditLogCount: number
): Promise<AuditExportSnapshot> => {
  const exportId = generateId();
  
  const snapshot: AuditExportSnapshot = {
    id: generateId(),
    batchId,
    exportId,
    timestamp: new Date(),
    format,
    includeAuditSummary,
    anomalies: JSON.parse(JSON.stringify(anomalies)),
    corrections: JSON.parse(JSON.stringify(corrections)),
    batchStats: JSON.parse(JSON.stringify(batchStats)),
    statsVersion,
    auditLogCount,
  };

  await auditExportSnapshotOperations.add(snapshot);
  return snapshot;
};

export const getExportSnapshots = async (
  batchId: string
): Promise<AuditExportSnapshot[]> => {
  return auditExportSnapshotOperations.getByBatchId(batchId);
};

export const checkRestoreConflicts = async (
  snapshotId: string
): Promise<RestoreCheckResult> => {
  const snapshot = await auditExportSnapshotOperations.getById(snapshotId);
  
  if (!snapshot) {
    return {
      canRestore: false,
      conflicts: [{
        type: 'not_found',
        message: '导出快照不存在',
      }],
      currentStatsVersion: 0,
      snapshotStatsVersion: 0,
    };
  }

  const batch = await batchOperations.getById(snapshot.batchId);
  const conflicts: RestoreCheckResult['conflicts'] = [];

  if (!batch) {
    return {
      canRestore: false,
      conflicts: [{
        type: 'not_found',
        message: '批次不存在',
      }],
      currentStatsVersion: 0,
      snapshotStatsVersion: snapshot.statsVersion,
    };
  }

  const currentStatsVersion = batch.statsVersion || 0;
  const snapshotStatsVersion = snapshot.statsVersion;

  if (currentStatsVersion !== snapshotStatsVersion) {
    conflicts.push({
      type: 'stats_version_mismatch',
      message: `统计版本不一致：当前版本 ${currentStatsVersion}，快照版本 ${snapshotStatsVersion}`,
      details: {
        current: currentStatsVersion,
        snapshot: snapshotStatsVersion,
      },
    });
  }

  const currentAnomalies = await anomalyOperations.getByBatchId(snapshot.batchId);
  const currentCorrections = await correctionOperations.getByBatchId(snapshot.batchId);

  if (currentAnomalies.length !== snapshot.anomalies.length) {
    conflicts.push({
      type: 'data_changed',
      message: `异常数据已变更：当前 ${currentAnomalies.length} 条，快照 ${snapshot.anomalies.length} 条`,
      details: {
        currentAnomalies: currentAnomalies.length,
        snapshotAnomalies: snapshot.anomalies.length,
      },
    });
  }

  if (currentCorrections.length !== snapshot.corrections.length) {
    conflicts.push({
      type: 'data_changed',
      message: `修正记录已变更：当前 ${currentCorrections.length} 条，快照 ${snapshot.corrections.length} 条`,
      details: {
        currentCorrections: currentCorrections.length,
        snapshotCorrections: snapshot.corrections.length,
      },
    });
  }

  if (batch.updatedAt > snapshot.timestamp) {
    conflicts.push({
      type: 'batch_updated',
      message: `批次在导出后已更新：最后更新于 ${batch.updatedAt.toLocaleString()}`,
      details: {
        batchUpdatedAt: batch.updatedAt,
        snapshotCreatedAt: snapshot.timestamp,
      },
    });
  }

  return {
    canRestore: conflicts.length === 0,
    conflicts,
    currentStatsVersion,
    snapshotStatsVersion,
  };
};

export const restoreToSnapshot = async (
  snapshotId: string,
  force: boolean = false
): Promise<{ success: boolean; message: string; conflicts?: RestoreCheckResult['conflicts'] }> => {
  const checkResult = await checkRestoreConflicts(snapshotId);
  
  if (!force && !checkResult.canRestore) {
    return {
      success: false,
      message: '存在冲突，无法恢复。请确认后使用强制恢复。',
      conflicts: checkResult.conflicts,
    };
  }

  const snapshot = await auditExportSnapshotOperations.getById(snapshotId);
  if (!snapshot) {
    return {
      success: false,
      message: '导出快照不存在',
    };
  }

  const batch = await batchOperations.getById(snapshot.batchId);
  if (!batch) {
    return {
      success: false,
      message: '批次不存在',
    };
  }

  const [currentAnomalies, currentCorrections, currentAuditLogs] = await Promise.all([
    anomalyOperations.getByBatchId(snapshot.batchId),
    correctionOperations.getByBatchId(snapshot.batchId),
    auditLogOperations.getByBatchId(snapshot.batchId),
  ]);

  const statsBefore = createStatsSnapshot(batch.stats, currentAnomalies);

  try {
    const anomalyIdsToDelete = currentAnomalies.map(a => a.id);
    const correctionIdsToDelete = currentCorrections.map(c => c.id);

    const snapshotAnomalyIds = new Set(snapshot.anomalies.map(a => a.id));
    const snapshotCorrectionIds = new Set(snapshot.corrections.map(c => c.id));

    const anomaliesToDelete = currentAnomalies.filter(a => !snapshotAnomalyIds.has(a.id));
    const correctionsToDelete = currentCorrections.filter(c => !snapshotCorrectionIds.has(c.id));

    if (anomaliesToDelete.length > 0) {
      const anomalyIdsToRemove = anomaliesToDelete.map(a => a.id);
      const tx = await (await import('../../db')).getDB().then(db => db.transaction('anomalies', 'readwrite'));
      for (const id of anomalyIdsToRemove) {
        await tx.store.delete(id);
      }
      await tx.done;
    }

    if (correctionsToDelete.length > 0) {
      const correctionIdsToRemove = correctionsToDelete.map(c => c.id);
      const tx = await (await import('../../db')).getDB().then(db => db.transaction('corrections', 'readwrite'));
      for (const id of correctionIdsToRemove) {
        await tx.store.delete(id);
      }
      await tx.done;
    }

    await anomalyOperations.addMany(snapshot.anomalies.filter(a => !anomalyIdsToDelete.includes(a.id)));
    await correctionOperations.addMany(snapshot.corrections.filter(c => !correctionIdsToDelete.includes(c.id)));

    const updatedBatch: Batch = {
      ...batch,
      stats: snapshot.batchStats,
      statsVersion: snapshot.statsVersion,
      updatedAt: new Date(),
    };
    await batchOperations.update(updatedBatch);

    const statsAfter = createStatsSnapshot(snapshot.batchStats, snapshot.anomalies);

    await createAuditLog({
      batchId: snapshot.batchId,
      action: 'restore',
      description: `恢复到导出快照（${snapshot.format}格式，${snapshot.timestamp.toLocaleString()}）${force ? '（强制恢复）' : ''}`,
      success: true,
      statsBefore,
      statsAfter,
      metadata: {
        snapshotId,
        exportId: snapshot.exportId,
        format: snapshot.format,
        force,
        conflicts: checkResult.conflicts,
      },
      linkedEntityIds: {
        anomalyIds: snapshot.anomalies.map(a => a.id),
        correctionIds: snapshot.corrections.map(c => c.id),
      },
      statsVersion: snapshot.statsVersion + 1,
    });

    return {
      success: true,
      message: `成功恢复到 ${snapshot.timestamp.toLocaleString()} 的导出状态`,
      conflicts: checkResult.conflicts.length > 0 ? checkResult.conflicts : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: `恢复失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
};

export const generateAuditSummaryHTML = (
  auditLogs: AuditLogEntry[],
  batchName: string
): string => {
  if (auditLogs.length === 0) return '';

  const actionCounts: Record<string, number> = {};
  auditLogs.forEach(log => {
    actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
  });

  const rows = auditLogs.slice(0, 50).map(log => `
    <tr>
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td><span class="badge badge-action">${ACTION_LABELS[log.action] || log.action}</span></td>
      <td>${log.operator}</td>
      <td>${log.description}</td>
      <td><span class="badge ${log.success ? 'badge-success' : 'badge-error'}">${log.success ? '成功' : '失败'}</span></td>
      <td>${log.statsBefore.totalAnomalies} → ${log.statsAfter.totalAnomalies}</td>
      <td>${log.statsBefore.pendingAnomalies} → ${log.statsAfter.pendingAnomalies}</td>
    </tr>
  `).join('');

  const actionStats = Object.entries(actionCounts)
    .map(([action, count]) => `
      <div class="stat-item">
        <div class="stat-label">${ACTION_LABELS[action as AuditActionType] || action}</div>
        <div class="stat-value">${count}</div>
      </div>
    `).join('');

  return `
    <div class="section audit-section">
      <h3>审计摘要 - ${batchName}</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">审计记录总数</div>
          <div class="value">${auditLogs.length}</div>
        </div>
        ${actionStats}
      </div>
      <h4 style="margin-top: 20px; margin-bottom: 12px;">操作时间线 (最近50条)</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作类型</th>
            <th>操作人</th>
            <th>描述</th>
            <th>状态</th>
            <th>异常总数变化</th>
            <th>待处理变化</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <style>
        .audit-section .badge-action { background: #3b82f6; }
        .audit-section .badge-success { background: #10b981; }
        .audit-section .badge-error { background: #ef4444; }
      </style>
    </div>
  `;
};

export const generateAuditSummaryMarkdown = (
  auditLogs: AuditLogEntry[],
  batchName: string
): string => {
  if (auditLogs.length === 0) return '';

  const actionCounts: Record<string, number> = {};
  auditLogs.forEach(log => {
    actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
  });

  let content = `## 审计摘要\n\n`;
  content += `> 批次：${batchName}\n`;
  content += `> 审计记录总数：${auditLogs.length}\n\n`;

  content += `### 操作统计\n\n`;
  content += `| 操作类型 | 次数 |\n`;
  content += `|----------|------|\n`;
  Object.entries(actionCounts).forEach(([action, count]) => {
    content += `| ${ACTION_LABELS[action as AuditActionType] || action} | ${count} |\n`;
  });
  content += '\n';

  content += `### 操作时间线 (最近50条)\n\n`;
  content += `| 时间 | 操作类型 | 操作人 | 描述 | 状态 | 异常总数 | 待处理 |\n`;
  content += `|------|----------|--------|------|------|----------|--------|\n`;
  
  auditLogs.slice(0, 50).forEach(log => {
    content += `| ${new Date(log.timestamp).toLocaleString()} | ${ACTION_LABELS[log.action] || log.action} | ${log.operator} | ${log.description.replace(/\|/g, '\\|')} | ${log.success ? '成功' : '失败'} | ${log.statsBefore.totalAnomalies} → ${log.statsAfter.totalAnomalies} | ${log.statsBefore.pendingAnomalies} → ${log.statsAfter.pendingAnomalies} |\n`;
  });
  content += '\n';

  return content;
};

export const generateAuditSummaryCSV = (
  auditLogs: AuditLogEntry[]
): string => {
  if (auditLogs.length === 0) return '';

  const headers = ['时间', '操作类型', '操作人', '描述', '状态', '异常总数(前)', '异常总数(后)', '待处理(前)', '待处理(后)'];
  const rows = auditLogs.map(log => [
    new Date(log.timestamp).toLocaleString(),
    ACTION_LABELS[log.action] || log.action,
    log.operator,
    `"${log.description.replace(/"/g, '""')}"`,
    log.success ? '成功' : '失败',
    log.statsBefore.totalAnomalies,
    log.statsAfter.totalAnomalies,
    log.statsBefore.pendingAnomalies,
    log.statsAfter.pendingAnomalies,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const auditModule = {
  ACTION_LABELS,
  createStatsSnapshot,
  createAuditLog,
  getBatchAuditTimeline,
  getBatchAuditTimelineByAction,
  createExportSnapshot,
  getExportSnapshots,
  checkRestoreConflicts,
  restoreToSnapshot,
  generateAuditSummaryHTML,
  generateAuditSummaryMarkdown,
  generateAuditSummaryCSV,
};

export default auditModule;
