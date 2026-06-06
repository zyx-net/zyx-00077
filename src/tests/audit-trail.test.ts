import 'fake-indexeddb/auto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB,
  clearDB,
  anomalyOperations,
  correctionOperations,
  batchOperations,
  scheduleOperations,
  punchOperations,
  auditLogOperations,
  auditExportSnapshotOperations,
} from '../db';
import { correctAnomaly, revertCorrection } from '../modules/correction';
import { useAppStore } from '../store';
import auditModule, {
  createStatsSnapshot,
  createAuditLog,
  getBatchAuditTimeline,
  createExportSnapshot,
  checkRestoreConflicts,
  restoreToSnapshot,
  generateAuditSummaryHTML,
  generateAuditSummaryMarkdown,
  generateAuditSummaryCSV,
} from '../modules/audit';
import { generateId, parseDateTime } from '../utils/dateUtils';
import type {
  Anomaly,
  ScheduleRecord,
  PunchRecord,
  Batch,
  Correction,
  AuditLogEntry,
  AuditActionType,
} from '../types';

describe('审计追踪功能测试', () => {
  let testBatchId: string;
  let testAnomalyIds: string[] = [];
  let testRuleVersionId = 'test-rule-v1';

  const createTestBatch = async (name: string, statsVersion: number = 1): Promise<Batch> => {
    const batch: Batch = {
      id: generateId(),
      name,
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
      timezone: 'Asia/Shanghai',
      fieldMapping: { schedule: {}, punch: {}, leave: {} },
      stats: {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 0,
        pendingAnomalies: 0,
        correctedAnomalies: 0,
      },
      statsVersion,
    };
    await batchOperations.add(batch);
    return batch;
  };

  const createTestAnomalies = async (batchId: string, count: number = 3): Promise<Anomaly[]> => {
    const anomalies: Anomaly[] = [];
    for (let i = 0; i < count; i++) {
      anomalies.push({
        id: generateId(),
        batchId,
        employeeId: `E00${i + 1}`,
        employeeName: `员工${i + 1}`,
        department: '技术部',
        scheduleDate: '2024-01-15',
        type: i % 2 === 0 ? 'late' : 'early_leave',
        severity: 'medium',
        status: 'pending',
        description: i % 2 === 0 ? '迟到15分钟' : '早退15分钟',
        durationMinutes: 15,
        scheduledStart: '09:00',
        scheduledEnd: '18:00',
        actualPunchIn: i % 2 === 0 ? parseDateTime('2024-01-15 09:15:00', 'Asia/Shanghai') : undefined,
        actualPunchOut: i % 2 === 1 ? parseDateTime('2024-01-15 17:45:00', 'Asia/Shanghai') : undefined,
        ruleVersionId: testRuleVersionId,
        metadata: {},
        createdAt: new Date(),
      });
    }
    await anomalyOperations.addMany(anomalies);
    return anomalies;
  };

  before(async () => {
    await initDB();
    await clearDB();
  });

  after(async () => {
    await clearDB();
    useAppStore.getState().clearCurrentBatchData();
  });

  describe('1. 导入后记录测试', () => {
    let importBatchId: string;

    before(async () => {
      const batch = await createTestBatch('导入记录测试批次');
      importBatchId = batch.id;
      await useAppStore.getState().selectBatch(importBatchId);
    });

    it('导入数据后记录审计日志', async () => {
      const state = useAppStore.getState();
      const currentBatch = state.getCurrentBatch();
      const statsBefore = auditModule.createStatsSnapshot(
        currentBatch?.stats,
        state.anomalies
      );

      const anomalies = await createTestAnomalies(importBatchId, 3);

      const log = await createAuditLog({
        batchId: importBatchId,
        action: 'import',
        description: '导入排班数据 50 条',
        success: true,
        statsBefore,
        statsAfter: auditModule.createStatsSnapshot(
          { totalSchedules: 50, totalPunches: 0, totalLeaves: 0, totalAnomalies: 3, pendingAnomalies: 3, correctedAnomalies: 0 },
          anomalies
        ),
        metadata: {
          dataType: 'schedule',
          fileName: 'schedule.csv',
          importCount: 50,
        },
        linkedEntityIds: {},
      });

      assert.ok(log.id);
      assert.equal(log.batchId, importBatchId);
      assert.equal(log.action, 'import');
      assert.equal(log.success, true);
      assert.equal(log.statsVersion, 2);
      assert.equal(log.statsAfter.totalAnomalies, 3);

      const timeline = await getBatchAuditTimeline(importBatchId);
      assert.equal(timeline.length, 1);
      assert.equal(timeline[0].id, log.id);

      console.log('✅ 导入记录测试通过');
    });

    it('记录失败的导入操作', async () => {
      const state = useAppStore.getState();
      const currentBatch = state.getCurrentBatch();
      const statsBefore = auditModule.createStatsSnapshot(
        currentBatch?.stats,
        state.anomalies
      );

      const log = await createAuditLog({
        batchId: importBatchId,
        action: 'import',
        description: '导入打卡数据失败',
        success: false,
        errorMessage: '文件格式错误',
        statsBefore,
        statsAfter: statsBefore,
        metadata: {
          dataType: 'punch',
          fileName: 'punch.xls',
        },
        linkedEntityIds: {},
      });

      assert.equal(log.success, false);
      assert.equal(log.errorMessage, '文件格式错误');
      assert.equal(log.statsVersion, 3);

      const timeline = await getBatchAuditTimeline(importBatchId);
      assert.equal(timeline.length, 2);
      assert.equal(timeline[0].success, false);
      assert.equal(timeline[0].errorMessage, '文件格式错误');

      console.log('✅ 失败导入记录测试通过');
    });
  });

  describe('2. 修正/撤回记录测试', () => {
    let correctionBatchId: string;
    let correctionAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('修正记录测试批次', 1);
      correctionBatchId = batch.id;
      correctionAnomalies = await createTestAnomalies(correctionBatchId, 5);
      
      batch.stats = {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 5,
        pendingAnomalies: 5,
        correctedAnomalies: 0,
      };
      await batchOperations.update(batch);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(correctionBatchId);
    });

    it('修正异常记录审计日志', async () => {
      const anomalyId = correctionAnomalies[0].id;
      const state = useAppStore.getState();

      const statsBefore = auditModule.createStatsSnapshot(
        { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 5, pendingAnomalies: 5, correctedAnomalies: 0 },
        state.anomalies
      );

      const result = await correctAnomaly(anomalyId, 'mark_normal', {}, '系统误报');
      assert.equal(result.success, true);

      if (result.updatedAnomaly && result.correction) {
        await state.updateAnomaly(result.updatedAnomaly);
        await state.addCorrection(result.correction);
      }

      const log = await createAuditLog({
        batchId: correctionBatchId,
        action: 'correction',
        description: '修正异常：标记为正常，原因：系统误报',
        success: true,
        statsBefore,
        statsAfter: auditModule.createStatsSnapshot(
          { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 5, pendingAnomalies: 4, correctedAnomalies: 1 },
          state.anomalies
        ),
        metadata: {
          correctionType: 'mark_normal',
          reason: '系统误报',
        },
        linkedEntityIds: {
          anomalyIds: [anomalyId],
          correctionIds: result.correction ? [result.correction.id] : [],
        },
      });

      assert.ok(log.id);
      assert.equal(log.action, 'correction');
      assert.equal(log.linkedEntityIds.anomalyIds?.length, 1);
      assert.equal(log.linkedEntityIds.anomalyIds?.[0], anomalyId);
      assert.equal(log.statsAfter.pendingAnomalies, 4);
      assert.equal(log.statsAfter.correctedAnomalies, 1);
      assert.equal(log.statsVersion, 2);

      console.log('✅ 修正记录审计测试通过');
    });

    it('撤回修正记录审计日志', async () => {
      await useAppStore.getState().selectBatch(correctionBatchId);
      const state = useAppStore.getState();
      const correction = state.corrections[0];
      assert.ok(correction, '应该存在至少一条修正记录');

      const statsBefore = auditModule.createStatsSnapshot(
        { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 5, pendingAnomalies: 4, correctedAnomalies: 1 },
        state.anomalies
      );

      const success = await revertCorrection(correction.id);
      assert.equal(success, true);

      const log = await createAuditLog({
        batchId: correctionBatchId,
        action: 'revert_correction',
        description: `撤回修正，原因：${correction.reason}`,
        success: true,
        statsBefore,
        statsAfter: auditModule.createStatsSnapshot(
          { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 5, pendingAnomalies: 5, correctedAnomalies: 0 },
          state.anomalies
        ),
        metadata: {
          correctionId: correction.id,
          correctionType: correction.type,
        },
        linkedEntityIds: {
          anomalyIds: [correction.anomalyId],
          correctionIds: [correction.id],
        },
      });

      assert.equal(log.action, 'revert_correction');
      assert.equal(log.statsAfter.pendingAnomalies, 5);
      assert.equal(log.statsAfter.correctedAnomalies, 0);
      assert.equal(log.statsVersion, 3);

      console.log('✅ 撤回修正记录审计测试通过');
    });

    it('规则切换记录审计日志', async () => {
      const state = useAppStore.getState();
      const currentBatch = state.getCurrentBatch();

      const statsBefore = auditModule.createStatsSnapshot(
        currentBatch?.stats,
        state.anomalies
      );

      const log = await createAuditLog({
        batchId: correctionBatchId,
        action: 'rule_switch',
        description: '切换规则版本：v1 → v2',
        success: true,
        statsBefore,
        statsAfter: {
          ...statsBefore,
          totalAnomalies: 6,
          pendingAnomalies: 5,
        },
        metadata: {
          oldVersionId: 'v1',
          oldVersionName: '默认规则',
          newVersionId: 'v2',
          newVersionName: '严格规则',
        },
        linkedEntityIds: {
          ruleVersionIds: ['v2'],
        },
      });

      assert.equal(log.action, 'rule_switch');
      assert.equal(log.statsAfter.totalAnomalies, 6);
      assert.equal(log.linkedEntityIds.ruleVersionIds?.[0], 'v2');
      assert.equal(log.statsVersion, 4);

      console.log('✅ 规则切换记录审计测试通过');
    });
  });

  describe('3. 跨重启（数据持久化）测试', () => {
    let persistentBatchId: string;

    before(async () => {
      const batch = await createTestBatch('持久化测试批次', 1);
      persistentBatchId = batch.id;
    });

    it('审计日志持久化到 IndexedDB', async () => {
      const actions: AuditActionType[] = ['import', 'analyze', 'correction', 'export'];
      const logIds: string[] = [];

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const stats = {
          totalSchedules: 50,
          totalPunches: 100,
          totalLeaves: 5,
          totalAnomalies: 5 + i,
          pendingAnomalies: 5 + i - Math.floor(i / 2),
          correctedAnomalies: Math.floor(i / 2),
        };

        const log = await createAuditLog({
          batchId: persistentBatchId,
          action,
          description: `测试动作 ${i + 1}: ${action}`,
          success: true,
          statsBefore: auditModule.createStatsSnapshot(stats, []),
          statsAfter: auditModule.createStatsSnapshot(stats, []),
          metadata: { testIteration: i },
          linkedEntityIds: {},
        });

        logIds.push(log.id);
      }

      const timeline = await getBatchAuditTimeline(persistentBatchId);
      assert.equal(timeline.length, 4);

      const timelineIds = timeline.map(log => log.id);
      logIds.forEach(id => {
        assert.equal(timelineIds.includes(id), true, `日志ID ${id} 应该在时间线中`);
      });

      timeline.forEach((log) => {
        assert.ok(log.timestamp instanceof Date);
        assert.equal(log.operator, 'user');
      });

      const latestVersion = await auditLogOperations.getLatestStatsVersion(persistentBatchId);
      assert.equal(latestVersion, 5);

      console.log('✅ 审计日志持久化测试通过');
    });

    it('模拟重启后数据仍可访问', async () => {
      useAppStore.getState().clearCurrentBatchData();

      const timeline = await getBatchAuditTimeline(persistentBatchId);
      assert.equal(timeline.length, 4, '重启后审计日志数量应保持不变');

      const latestVersion = await auditLogOperations.getLatestStatsVersion(persistentBatchId);
      assert.equal(latestVersion, 5, '重启后统计版本号应保持不变');

      const batch = await batchOperations.getById(persistentBatchId);
      assert.ok(batch);
      assert.equal(batch.statsVersion, 5);

      await useAppStore.getState().selectBatch(persistentBatchId);

      console.log('✅ 跨重启数据持久化测试通过');
    });
  });

  describe('4. 冲突提示测试', () => {
    let conflictBatchId: string;
    let snapshotId: string;

    before(async () => {
      const batch = await createTestBatch('冲突测试批次', 1);
      conflictBatchId = batch.id;
      const anomalies = await createTestAnomalies(conflictBatchId, 3);
      await useAppStore.getState().selectBatch(conflictBatchId);
    });

    it('创建导出快照', async () => {
      const state = useAppStore.getState();
      const currentBatch = state.getCurrentBatch();
      
      const snapshot = await createExportSnapshot(
        conflictBatchId,
        'html',
        true,
        state.anomalies,
        state.corrections,
        currentBatch?.stats || { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 },
        currentBatch?.statsVersion || 1,
        state.auditLogs.length
      );
      snapshotId = snapshot.id;

      assert.ok(snapshot.id);
      assert.equal(snapshot.batchId, conflictBatchId);
      assert.equal(snapshot.format, 'html');
      assert.equal(snapshot.includeAuditSummary, true);
      assert.equal(snapshot.statsVersion, 1);
      assert.equal(snapshot.anomalies.length, 3);
      assert.equal(snapshot.auditLogCount, 0);

      console.log('✅ 创建导出快照测试通过');
    });

    it('无冲突时可安全恢复', async () => {
      const checkResult = await checkRestoreConflicts(snapshotId);

      assert.equal(checkResult.canRestore, true);
      assert.equal(checkResult.conflicts.length, 0);
      assert.equal(checkResult.currentStatsVersion, 1);
      assert.equal(checkResult.snapshotStatsVersion, 1);

      console.log('✅ 无冲突恢复检测测试通过');
    });

    it('检测到统计版本不一致冲突', async () => {
      const state = useAppStore.getState();
      const currentBatch = state.getCurrentBatch();

      await createAuditLog({
        batchId: conflictBatchId,
        action: 'correction',
        description: '模拟后续操作',
        success: true,
        statsBefore: auditModule.createStatsSnapshot(
          currentBatch?.stats,
          state.anomalies
        ),
        statsAfter: auditModule.createStatsSnapshot(
          { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 3, pendingAnomalies: 2, correctedAnomalies: 1 },
          state.anomalies
        ),
        metadata: {},
        linkedEntityIds: {},
      });

      const checkResult = await checkRestoreConflicts(snapshotId);

      assert.equal(checkResult.canRestore, false);
      assert.equal(checkResult.conflicts.length >= 1, true);

      const versionConflict = checkResult.conflicts.find(c => c.type === 'stats_version_mismatch');
      assert.ok(versionConflict);
      assert.equal(versionConflict.message.includes('版本不一致'), true);

      console.log('✅ 统计版本不一致冲突检测测试通过');
    });

    it('检测到数据变更冲突', async () => {
      await createTestAnomalies(conflictBatchId, 2);

      const checkResult = await checkRestoreConflicts(snapshotId);

      assert.equal(checkResult.canRestore, false);
      const dataConflict = checkResult.conflicts.find(c => c.type === 'data_changed');
      assert.ok(dataConflict);
      assert.equal(dataConflict.message.includes('异常数据已变更'), true);

      console.log('✅ 数据变更冲突检测测试通过');
    });

    it('检测到批次更新冲突', async () => {
      const batch = await batchOperations.getById(conflictBatchId);
      if (batch) {
        batch.updatedAt = new Date(Date.now() + 86400000);
        await batchOperations.update(batch);
      }

      const checkResult = await checkRestoreConflicts(snapshotId);

      assert.equal(checkResult.canRestore, false);
      const batchConflict = checkResult.conflicts.find(c => c.type === 'batch_updated');
      assert.ok(batchConflict);
      assert.equal(batchConflict.message.includes('批次在导出后已更新'), true);

      console.log('✅ 批次更新冲突检测测试通过');
    });

    it('非强制模式下有冲突时拒绝恢复', async () => {
      const result = await restoreToSnapshot(snapshotId, false);

      assert.equal(result.success, false);
      assert.equal(result.message.includes('存在冲突'), true);
      assert.ok(result.conflicts);
      assert.equal(result.conflicts.length >= 1, true);

      console.log('✅ 非强制模式冲突拒绝测试通过');
    });

    it('强制模式下可覆盖恢复', async () => {
      const result = await restoreToSnapshot(snapshotId, true);

      assert.equal(result.success, true);
      assert.equal(result.message.includes('成功恢复'), true);

      const anomalies = await anomalyOperations.getByBatchId(conflictBatchId);
      assert.equal(anomalies.length, 3, '恢复后异常数量应与快照一致');

      const batch = await batchOperations.getById(conflictBatchId);
      assert.ok(batch);
      assert.equal(batch.statsVersion, 2, '恢复后统计版本应为快照版本+1');

      const timeline = await getBatchAuditTimeline(conflictBatchId);
      const restoreLog = timeline.find(log => log.action === 'restore');
      assert.ok(restoreLog);
      assert.equal(restoreLog.success, true);
      assert.equal(restoreLog.metadata.force, true);

      console.log('✅ 强制覆盖恢复测试通过');
    });
  });

  describe('5. 带审计摘要导出测试', () => {
    let exportBatchId: string;

    before(async () => {
      const batch = await createTestBatch('导出测试批次', 1);
      exportBatchId = batch.id;
      await createTestAnomalies(exportBatchId, 2);

      for (let i = 0; i < 5; i++) {
        await createAuditLog({
          batchId: exportBatchId,
          action: i % 2 === 0 ? 'correction' : 'import',
          description: `测试操作 ${i + 1}`,
          success: i < 4,
          errorMessage: i >= 4 ? '模拟错误' : undefined,
          statsBefore: auditModule.createStatsSnapshot({ totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 2 + i, pendingAnomalies: 2, correctedAnomalies: 0 }, []),
          statsAfter: auditModule.createStatsSnapshot({ totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 3 + i, pendingAnomalies: 2, correctedAnomalies: 0 }, []),
          metadata: { test: i },
          linkedEntityIds: {},
        });
      }

      await useAppStore.getState().selectBatch(exportBatchId);
    });

    it('生成 HTML 审计摘要', () => {
      const auditLogs = useAppStore.getState().auditLogs;
      const summary = generateAuditSummaryHTML(auditLogs, '导出测试批次');

      assert.ok(summary);
      assert.equal(summary.includes('审计摘要'), true);
      assert.equal(summary.includes('导出测试批次'), true);
      assert.equal(summary.includes('人工修正'), true);
      assert.equal(summary.includes('导入数据'), true);
      assert.equal(summary.includes('操作时间线'), true);

      console.log('✅ HTML 审计摘要生成测试通过');
    });

    it('生成 Markdown 审计摘要', () => {
      const auditLogs = useAppStore.getState().auditLogs;
      const summary = generateAuditSummaryMarkdown(auditLogs, '导出测试批次');

      assert.ok(summary);
      assert.equal(summary.includes('## 审计摘要'), true);
      assert.equal(summary.includes('导出测试批次'), true);
      assert.equal(summary.includes('### 操作统计'), true);
      assert.equal(summary.includes('| 人工修正 |'), true);
      assert.equal(summary.includes('| 导入数据 |'), true);

      console.log('✅ Markdown 审计摘要生成测试通过');
    });

    it('生成 CSV 审计摘要', () => {
      const auditLogs = useAppStore.getState().auditLogs;
      const summary = generateAuditSummaryCSV(auditLogs);

      assert.ok(summary);
      const lines = summary.trim().split('\n');
      assert.equal(lines.length >= 6, true);

      const header = lines[0];
      assert.equal(header.includes('时间'), true);
      assert.equal(header.includes('操作类型'), true);
      assert.equal(header.includes('操作人'), true);
      assert.equal(header.includes('描述'), true);
      assert.equal(header.includes('状态'), true);
      assert.equal(header.includes('异常总数(前)'), true);
      assert.equal(header.includes('异常总数(后)'), true);

      console.log('✅ CSV 审计摘要生成测试通过');
    });

    it('创建带审计摘要的导出快照', async () => {
      const state = useAppStore.getState();
      const currentBatch = state.getCurrentBatch();
      
      const snapshot = await createExportSnapshot(
        exportBatchId,
        'html',
        true,
        state.anomalies,
        state.corrections,
        currentBatch?.stats || { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 },
        currentBatch?.statsVersion || 6,
        state.auditLogs.length
      );

      assert.ok(snapshot.id);
      assert.equal(snapshot.includeAuditSummary, true);
      assert.equal(snapshot.auditLogCount, 5);
      assert.equal(snapshot.statsVersion, 6);

      console.log('✅ 带审计摘要导出快照测试通过');
    });

    it('空日志生成安全摘要', () => {
      const emptySummaryHTML = generateAuditSummaryHTML([], '测试批次');
      const emptySummaryMD = generateAuditSummaryMarkdown([], '测试批次');
      const emptySummaryCSV = generateAuditSummaryCSV([]);

      assert.equal(emptySummaryHTML, '');
      assert.equal(emptySummaryMD, '');
      assert.equal(emptySummaryCSV, '');

      console.log('✅ 空日志摘要安全测试通过');
    });
  });

  describe('6. 完整时间线集成测试', () => {
    let integrationBatchId: string;

    before(async () => {
      const batch = await createTestBatch('集成测试批次', 1);
      integrationBatchId = batch.id;
      await useAppStore.getState().selectBatch(integrationBatchId);
    });

    it('完整操作流程时间线记录正确', async () => {
      await createAuditLog({
        batchId: integrationBatchId,
        action: 'import',
        description: '导入排班数据 50 条',
        success: true,
        statsBefore: auditModule.createStatsSnapshot({ totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 }, []),
        statsAfter: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 }, []),
        metadata: { dataType: 'schedule', importCount: 50 },
        linkedEntityIds: {},
      });

      await createAuditLog({
        batchId: integrationBatchId,
        action: 'import',
        description: '导入打卡数据 100 条',
        success: true,
        statsBefore: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 }, []),
        statsAfter: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 100, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 }, []),
        metadata: { dataType: 'punch', importCount: 100 },
        linkedEntityIds: {},
      });

      const anomalies = await createTestAnomalies(integrationBatchId, 5);

      await createAuditLog({
        batchId: integrationBatchId,
        action: 'analyze',
        description: '数据分析完成：匹配 100 条记录，发现 5 个异常',
        success: true,
        statsBefore: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 100, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 }, []),
        statsAfter: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 100, totalLeaves: 0, totalAnomalies: 5, pendingAnomalies: 5, correctedAnomalies: 0 }, anomalies),
        metadata: { matchedCount: 100, anomalyCount: 5 },
        linkedEntityIds: {},
      });

      await createAuditLog({
        batchId: integrationBatchId,
        action: 'rule_switch',
        description: '切换规则版本：默认 → 严格',
        success: true,
        statsBefore: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 100, totalLeaves: 0, totalAnomalies: 5, pendingAnomalies: 5, correctedAnomalies: 0 }, anomalies),
        statsAfter: auditModule.createStatsSnapshot({ totalSchedules: 50, totalPunches: 100, totalLeaves: 0, totalAnomalies: 7, pendingAnomalies: 7, correctedAnomalies: 0 }, anomalies),
        metadata: { oldVersion: '默认', newVersion: '严格' },
        linkedEntityIds: { ruleVersionIds: ['strict-v1'] },
      });

      const timeline = await getBatchAuditTimeline(integrationBatchId);

      assert.equal(timeline.length, 4);
      assert.equal(timeline[0].action, 'rule_switch');
      assert.equal(timeline[1].action, 'analyze');
      assert.equal(timeline[2].action, 'import');
      assert.equal(timeline[3].action, 'import');

      assert.equal(timeline[0].statsVersion, 5);
      assert.equal(timeline[3].statsVersion, 2);

      assert.equal(timeline[2].description.includes('打卡数据'), true);
      assert.equal(timeline[3].description.includes('排班数据'), true);

      const totalOps: Record<string, number> = {};
      timeline.forEach(log => {
        totalOps[log.action] = (totalOps[log.action] || 0) + 1;
      });
      assert.equal(totalOps.import, 2);
      assert.equal(totalOps.analyze, 1);
      assert.equal(totalOps.rule_switch, 1);

      console.log('✅ 完整时间线集成测试通过');
    });
  });
});
