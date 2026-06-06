import 'fake-indexeddb/auto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, clearDB, simulatorOperations, batchOperations, ruleVersionOperations, scheduleOperations, punchOperations, matchedRecordOperations, anomalyOperations } from '../db';
import { useAppStore } from '../store';
import { generateId } from '../utils/dateUtils';
import type {
  Simulator,
  SimulatorCreateParams,
  SimulatorRuleParams,
  SimulatorConflict,
  SimulatorConflictType,
  Anomaly,
  ScheduleRecord,
  PunchRecord,
  MatchedRecord,
  RuleConfig,
  AuditActionType,
} from '../types';
import {
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
  extractParamsFromRules,
  applyParamsToRules,
  DEFAULT_PARAMS,
} from '../modules/simulator';
import { createDefaultRules, initializeRuleVersions, createRuleVersion } from '../modules/rules';
import { getBatchAuditTimeline } from '../modules/audit';

describe('规则影响模拟器测试', () => {
  let testBatchId: string;
  let testRuleVersionId: string;

  const createTestBatchData = async () => {
    const state = useAppStore.getState();
    const batch = await state.createBatch('模拟器测试批次');
    testBatchId = batch.id;

    const schedules: ScheduleRecord[] = [
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        department: '技术部',
        scheduleDate: '2024-01-15',
        startTime: '09:00',
        endTime: '18:00',
        shiftType: 'normal',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        department: '技术部',
        scheduleDate: '2024-01-16',
        startTime: '22:00',
        endTime: '06:00',
        shiftType: 'crossDay',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E002',
        employeeName: '李四',
        department: '市场部',
        scheduleDate: '2024-01-15',
        startTime: '09:00',
        endTime: '18:00',
        shiftType: 'normal',
      },
    ];

    const punches: PunchRecord[] = [
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        punchTime: new Date('2024-01-15T09:15:00'),
        punchType: 'in',
        timezone: 'Asia/Shanghai',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        punchTime: new Date('2024-01-15T09:17:00'),
        punchType: 'in',
        timezone: 'Asia/Shanghai',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        punchTime: new Date('2024-01-15T17:30:00'),
        punchType: 'out',
        timezone: 'Asia/Shanghai',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        punchTime: new Date('2024-01-15T22:10:00'),
        punchType: 'in',
        timezone: 'Asia/Shanghai',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        punchTime: new Date('2024-01-16T05:50:00'),
        punchType: 'out',
        timezone: 'Asia/Shanghai',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E002',
        employeeName: '李四',
        punchTime: new Date('2024-01-15T09:30:00'),
        punchType: 'in',
        timezone: 'Asia/Shanghai',
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E002',
        employeeName: '李四',
        punchTime: new Date('2024-01-15T17:00:00'),
        punchType: 'out',
        timezone: 'Asia/Shanghai',
      },
    ];

    await scheduleOperations.addMany(schedules);
    await punchOperations.addMany(punches);

    await state.selectBatch(testBatchId);

    const matchModule = await import('../modules/match');
    const matchResult = matchModule.matchSchedulesAndPunches(testBatchId, schedules, punches, []);
    await state.saveMatchedRecords(matchResult.matched);

    const activeVersion = await ruleVersionOperations.getActive();
    if (activeVersion) {
      testRuleVersionId = activeVersion.id;
    }

    const rulesModule = await import('../modules/rules');
    const detectionResult = await rulesModule.runAnomalyDetection(matchResult.matched, testRuleVersionId);
    await state.saveAnomalies(detectionResult.anomalies);

    return { schedules, punches, matchedRecords: matchResult.matched, anomalies: detectionResult.anomalies };
  };

  before(async () => {
    await initDB();
    await clearDB();
    await simulatorOperations.clear();
    useAppStore.getState().clearCurrentBatchData();
    await initializeRuleVersions();
    await createTestBatchData();
  });

  after(async () => {
    await clearDB();
    await simulatorOperations.clear();
    useAppStore.getState().clearCurrentBatchData();
  });

  describe('1. 核心参数提取与应用', () => {
    it('extractParamsFromRules 从规则中提取参数', () => {
      const rules = createDefaultRules();
      const params = extractParamsFromRules(rules);

      assert.equal(params.lateGracePeriodMinutes, 10);
      assert.equal(params.earlyLeaveThresholdMinutes, 180);
      assert.equal(params.crossDayMaxHours, 16);
      assert.equal(params.duplicatePunchWindowMinutes, 5);

      console.log('✅ 从规则中提取参数成功');
    });

    it('applyParamsToRules 将参数应用到规则', () => {
      const rules = createDefaultRules();
      const newParams: SimulatorRuleParams = {
        lateGracePeriodMinutes: 30,
        earlyLeaveThresholdMinutes: 60,
        crossDayMaxHours: 12,
        duplicatePunchWindowMinutes: 10,
      };

      const updatedRules = applyParamsToRules(rules, newParams);

      const lateRule = updatedRules.find(r => r.anomalyType === 'late');
      assert.equal(lateRule?.params.gracePeriodMinutes, 30);

      const earlyLeaveRule = updatedRules.find(r => r.anomalyType === 'early_leave');
      assert.equal(earlyLeaveRule?.params.thresholdMinutes, 60);

      const crossDayRule = updatedRules.find(r => r.anomalyType === 'cross_day');
      assert.equal(crossDayRule?.params.maxCrossHours, 12);

      const duplicateRule = updatedRules.find(r => r.anomalyType === 'duplicate');
      assert.equal(duplicateRule?.params.thresholdMinutes, 10);

      console.log('✅ 将参数应用到规则成功');
    });

    it('DEFAULT_PARAMS 包含正确的默认值', () => {
      assert.equal(DEFAULT_PARAMS.lateGracePeriodMinutes, 10);
      assert.equal(DEFAULT_PARAMS.earlyLeaveThresholdMinutes, 180);
      assert.equal(DEFAULT_PARAMS.crossDayMaxHours, 16);
      assert.equal(DEFAULT_PARAMS.duplicatePunchWindowMinutes, 5);

      console.log('✅ 默认参数验证成功');
    });
  });

  describe('2. 模拟方案创建和 CRUD 操作', () => {
    it('createSimulator 创建模拟方案成功', async () => {
      const result = await createSimulator({
        name: '标准模拟方案',
        description: '测试默认参数的模拟效果',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });

      assert.equal(result.success, true);
      assert.equal(result.requiresConfirmation, false);
      assert.ok(result.simulator);
      assert.ok(result.simulator.id);
      assert.equal(result.simulator.name, '标准模拟方案');
      assert.equal(result.simulator.sourceBatchId, testBatchId);
      assert.equal(result.simulator.status, 'draft');
      assert.equal(result.simulator.createdBy, 'test_user');
      assert.equal(result.simulator.permissions.owner, 'test_user');
      assert.equal(result.simulator.schemaVersion, 1);
      assert.ok(result.simulator.dataSnapshot);
      assert.ok(result.simulator.dataSnapshot.schedules.length > 0);
      assert.ok(result.simulator.dataSnapshot.punches.length > 0);
      assert.ok(result.simulator.dataSnapshot.matchedRecords.length > 0);
      assert.ok(result.simulator.dataSnapshot.originalAnomalies.length > 0);
      assert.equal(result.simulator.dataSnapshot.originalRuleVersionId, testRuleVersionId);

      console.log('✅ 创建模拟方案成功');
    });

    it('createSimulator 检测同名冲突', async () => {
      const result = await createSimulator({
        name: '标准模拟方案',
        description: '同名的模拟方案',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });

      assert.equal(result.success, false);
      assert.equal(result.requiresConfirmation, true);
      assert.ok(result.conflicts);
      assert.equal(result.conflicts[0].type, 'name_exists');
      assert.equal(result.conflicts[0].severity, 'error');
      assert.ok(result.conflicts[0].resolutionOptions.includes('overwrite'));
      assert.ok(result.conflicts[0].resolutionOptions.includes('rename'));
      assert.ok(result.conflicts[0].resolutionOptions.includes('cancel'));

      console.log('✅ 同名模拟方案冲突检测成功');
    });

    it('getSimulators 获取所有模拟方案', async () => {
      const simulators = await getSimulators();
      assert.equal(simulators.length, 1);
      assert.equal(simulators[0].name, '标准模拟方案');

      const byBatch = await getSimulators(testBatchId);
      assert.equal(byBatch.length, 1);

      console.log('✅ 获取模拟方案列表成功');
    });

    it('getSimulatorById 根据 ID 获取模拟方案', async () => {
      const all = await getSimulators();
      const first = all[0];

      const found = await getSimulatorById(first.id);
      assert.ok(found);
      assert.equal(found.id, first.id);
      assert.equal(found.name, first.name);

      console.log('✅ 根据ID获取模拟方案成功');
    });

    it('updateSimulator 更新模拟方案参数', async () => {
      const all = await getSimulators();
      const sim = all[0];

      const updated = await updateSimulator({
        id: sim.id,
        name: '更新后的模拟方案',
        description: '更新参数后的方案',
        params: {
          lateGracePeriodMinutes: 30,
          earlyLeaveThresholdMinutes: 120,
        },
        operator: 'test_user',
      });

      assert.ok(updated);
      assert.equal(updated.name, '更新后的模拟方案');
      assert.equal(updated.description, '更新参数后的方案');
      assert.equal(updated.params.lateGracePeriodMinutes, 30);
      assert.equal(updated.params.earlyLeaveThresholdMinutes, 120);
      assert.equal(updated.params.crossDayMaxHours, 16);
      assert.equal(updated.status, 'draft');
      assert.equal(updated.simulationResult, undefined);

      console.log('✅ 更新模拟方案成功');
    });

    it('updateSimulator 无权限时抛出错误', async () => {
      const all = await getSimulators();
      const sim = all[0];

      await assert.rejects(
        async () => {
          await updateSimulator({
            id: sim.id,
            name: '非法更新',
            operator: 'unauthorized_user',
          });
        },
        (err: Error) => {
          assert.equal(err.message.includes('无编辑权限'), true);
          return true;
        }
      );

      console.log('✅ 无权限更新时抛出错误成功');
    });

    it('duplicateSimulator 复制模拟方案', async () => {
      const all = await getSimulators();
      const original = all[0];

      const duplicated = await duplicateSimulator(original.id, '复制的模拟方案', 'another_user');
      assert.ok(duplicated);
      assert.notEqual(duplicated.id, original.id);
      assert.equal(duplicated.name, '复制的模拟方案');
      assert.equal(duplicated.params.lateGracePeriodMinutes, original.params.lateGracePeriodMinutes);
      assert.equal(duplicated.permissions.owner, 'another_user');
      assert.equal(duplicated.metadata.duplicatedFrom, original.id);
      assert.equal(duplicated.status, 'draft');

      const afterDuplicate = await getSimulators();
      assert.equal(afterDuplicate.length, 2);

      console.log('✅ 复制模拟方案成功');
    });

    it('duplicateSimulator 检测同名冲突', async () => {
      const all = await getSimulators();
      const original = all[0];

      await assert.rejects(
        async () => {
          await duplicateSimulator(original.id, '更新后的模拟方案');
        },
        (err: Error) => {
          assert.equal(err.message.includes('已存在名为'), true);
          return true;
        }
      );

      console.log('✅ 复制时同名冲突检测成功');
    });

    it('deleteSimulator 删除模拟方案', async () => {
      const all = await getSimulators();
      const toDelete = all.find(s => s.name === '复制的模拟方案');
      assert.ok(toDelete);

      const result = await deleteSimulator(toDelete.id, toDelete.permissions.owner);
      assert.equal(result, true);

      const afterDelete = await getSimulators();
      assert.equal(afterDelete.length, 1);

      const notFound = await getSimulatorById(toDelete.id);
      assert.equal(notFound, undefined);

      console.log('✅ 删除模拟方案成功');
    });

    it('deleteSimulator 无权限时抛出错误', async () => {
      const all = await getSimulators();
      const sim = all[0];

      await assert.rejects(
        async () => {
          await deleteSimulator(sim.id, 'unauthorized_user');
        },
        (err: Error) => {
          assert.equal(err.message.includes('无删除权限'), true);
          return true;
        }
      );

      console.log('✅ 无权限删除时抛出错误成功');
    });
  });

  describe('3. 模拟计算引擎', () => {
    it('runSimulation 运行模拟计算', async () => {
      const all = await getSimulators();
      const sim = all[0];

      const result = await runSimulation(sim.id);

      assert.ok(result);
      assert.ok(result.simulator);
      assert.ok(result.result);
      assert.ok(result.diff);
      assert.equal(result.simulator.status, 'ready');
      assert.ok(result.simulator.simulationResult);
      assert.ok(result.simulator.simulationDiff);
      assert.equal(result.result.anomalies.length > 0, true);
      assert.equal(result.result.ruleVersionId.startsWith('simulator-temp-'), true);

      console.log('✅ 运行模拟计算成功');
    });

    it('calculateDiff 计算差异 - 新增异常', () => {
      const original: Anomaly[] = [];
      const simulated: Anomaly[] = [
        {
          id: 'a1',
          batchId: testBatchId,
          employeeId: 'E001',
          type: 'late',
          severity: 'medium',
          description: '迟到',
          status: 'pending',
          ruleVersionId: 'test',
          scheduleDate: '2024-01-15',
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const diff = calculateDiff(original, simulated);
      assert.equal(diff.summary.totalAdded, 1);
      assert.equal(diff.summary.totalRemoved, 0);
      assert.equal(diff.summary.totalModified, 0);
      assert.equal(diff.summary.netChange, 1);
      assert.equal(diff.items[0].type, 'added');

      console.log('✅ 差异计算 - 新增异常成功');
    });

    it('calculateDiff 计算差异 - 移除异常', () => {
      const original: Anomaly[] = [
        {
          id: 'a1',
          batchId: testBatchId,
          employeeId: 'E001',
          type: 'late',
          severity: 'medium',
          description: '迟到',
          status: 'pending',
          ruleVersionId: 'test',
          scheduleDate: '2024-01-15',
          metadata: {},
          createdAt: new Date(),
        },
      ];
      const simulated: Anomaly[] = [];

      const diff = calculateDiff(original, simulated);
      assert.equal(diff.summary.totalAdded, 0);
      assert.equal(diff.summary.totalRemoved, 1);
      assert.equal(diff.summary.totalModified, 0);
      assert.equal(diff.summary.netChange, -1);
      assert.equal(diff.items[0].type, 'removed');

      console.log('✅ 差异计算 - 移除异常成功');
    });

    it('calculateDiff 计算差异 - 修改异常', () => {
      const original: Anomaly[] = [
        {
          id: 'a1',
          batchId: testBatchId,
          employeeId: 'E001',
          type: 'late',
          severity: 'medium',
          description: '迟到 10 分钟',
          status: 'pending',
          ruleVersionId: 'test',
          scheduleDate: '2024-01-15',
          durationMinutes: 10,
          metadata: {},
          createdAt: new Date(),
        },
      ];
      const simulated: Anomaly[] = [
        {
          id: 'a1',
          batchId: testBatchId,
          employeeId: 'E001',
          type: 'late',
          severity: 'high',
          description: '迟到 70 分钟',
          status: 'pending',
          ruleVersionId: 'test',
          scheduleDate: '2024-01-15',
          durationMinutes: 70,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const diff = calculateDiff(original, simulated);
      assert.equal(diff.summary.totalAdded, 0);
      assert.equal(diff.summary.totalRemoved, 0);
      assert.equal(diff.summary.totalModified, 1);
      assert.equal(diff.summary.netChange, 0);
      assert.equal(diff.items[0].type, 'modified');

      console.log('✅ 差异计算 - 修改异常成功');
    });

    it('runSimulation 调整宽限时间后异常数量变化', async () => {
      const createResult = await createSimulator({
        name: '宽限时间测试',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(createResult.simulator);

      const defaultResult = await runSimulation(createResult.simulator.id);
      const defaultAnomalyCount = defaultResult.result.anomalies.length;

      const updated = await updateSimulator({
        id: createResult.simulator.id,
        params: { lateGracePeriodMinutes: 60 },
        operator: 'test_user',
      });
      assert.ok(updated);

      const relaxedResult = await runSimulation(updated.id);
      const relaxedAnomalyCount = relaxedResult.result.anomalies.length;

      assert.ok(relaxedAnomalyCount <= defaultAnomalyCount, '放宽宽限时间后异常数量应该减少或不变');

      console.log(`✅ 宽限时间调整验证：默认 ${defaultAnomalyCount} 条异常，放宽后 ${relaxedAnomalyCount} 条异常`);
    });
  });

  describe('4. 持久化和重启恢复', () => {
    it('模拟方案数据持久化到 IndexedDB', async () => {
      await simulatorOperations.clear();

      const result1 = await createSimulator({
        name: '持久化测试-方案1',
        sourceBatchId: testBatchId,
        operator: 'persist_user',
      });

      const result2 = await createSimulator({
        name: '持久化测试-方案2',
        sourceBatchId: testBatchId,
        operator: 'persist_user',
      });

      assert.ok(result1.simulator);
      assert.ok(result2.simulator);

      const stored = await simulatorOperations.getAll();
      assert.equal(stored.length, 2);

      const byId = await simulatorOperations.getById(result1.simulator.id);
      assert.ok(byId);
      assert.equal(byId.name, '持久化测试-方案1');
      assert.equal(byId.createdBy, 'persist_user');
      assert.ok(byId.dataSnapshot.schedules.length > 0);

      console.log('✅ 模拟方案数据持久化到IndexedDB成功');
    });

    it('模拟重启后数据仍可访问', async () => {
      const before = await simulatorOperations.getAll();
      assert.equal(before.length, 2);

      const storedIds = before.map(s => s.id);

      useAppStore.getState().simulators = [];
      useAppStore.setState({ simulators: [] });

      await useAppStore.getState().loadSimulators();

      const after = useAppStore.getState().simulators;
      assert.equal(after.length, 2);

      const afterIds = after.map(s => s.id);
      storedIds.forEach(id => {
        assert.equal(afterIds.includes(id), true, `方案ID ${id} 应该在重启后仍存在`);
      });

      const firstSim = after[0];
      assert.ok(firstSim.dataSnapshot);
      assert.ok(firstSim.dataSnapshot.schedules.length > 0);
      assert.ok(firstSim.dataSnapshot.punches.length > 0);

      console.log('✅ 模拟重启后模拟方案数据恢复成功');
    });

    it('草稿保存后重启仍可继续编辑', async () => {
      const all = await getSimulators();
      const draft = all[0];

      const saveResult = await saveSimulatorDraft(draft, false, draft.permissions.owner);
      assert.equal(saveResult.success, true);

      const beforeUpdate = await simulatorOperations.getById(draft.id);
      assert.ok(beforeUpdate);

      const updatedDraft = await updateSimulator({
        id: draft.id,
        params: { lateGracePeriodMinutes: 25 },
        operator: draft.permissions.owner,
      });
      assert.ok(updatedDraft);

      useAppStore.getState().simulators = [];
      await useAppStore.getState().loadSimulators();

      const afterRestart = useAppStore.getState().simulators.find(s => s.id === draft.id);
      assert.ok(afterRestart);
      assert.equal(afterRestart.params.lateGracePeriodMinutes, 25);
      assert.equal(afterRestart.status, 'draft');

      console.log('✅ 草稿保存后重启可继续编辑成功');
    });
  });

  describe('5. 导入导出 JSON 功能', () => {
    it('exportSimulatorsToJSON 导出所有方案', async () => {
      const result = await exportSimulatorsToJSON();

      assert.equal(result.schemaVersion, 1);
      assert.ok(result.exportedAt instanceof Date);
      assert.equal(result.exportedBy, 'user');
      assert.ok(result.simulators.length >= 2);

      const names = result.simulators.map(s => s.name).sort();
      assert.ok(names.includes('持久化测试-方案1'));
      assert.ok(names.includes('持久化测试-方案2'));

      console.log('✅ 导出所有模拟方案为JSON成功');
    });

    it('exportSimulatorsToJSON 导出指定方案', async () => {
      const all = await getSimulators();
      const idsToExport = [all[0].id];

      const result = await exportSimulatorsToJSON(idsToExport);
      assert.equal(result.simulators.length, 1);

      console.log('✅ 导出指定模拟方案为JSON成功');
    });

    it('importSimulatorsFromJSON 导入 - 无冲突', async () => {
      const exportResult = await exportSimulatorsToJSON();
      const originalCount = exportResult.simulators.length;

      const jsonToImport = {
        ...exportResult,
        simulators: exportResult.simulators.map(s => ({
          ...s,
          name: `导入的${s.name}`,
        })),
      };

      const result = await importSimulatorsFromJSON(jsonToImport, 'importer_user');

      assert.equal(result.imported.length, originalCount);
      assert.equal(result.skipped.length, 0);
      assert.equal(result.conflicts.length, 0);

      result.imported.forEach(sim => {
        assert.equal(sim.name.startsWith('导入的'), true);
        assert.equal(sim.createdBy, 'importer_user');
        assert.ok(sim.metadata.importedFrom);
      });

      const afterImport = await getSimulators();
      assert.equal(afterImport.length, originalCount * 2);

      for (const imported of result.imported) {
        await deleteSimulator(imported.id, imported.permissions.owner);
      }

      const afterCleanup = await getSimulators();
      assert.equal(afterCleanup.length, originalCount);

      console.log('✅ 导入JSON（无冲突）成功');
    });

    it('importSimulatorsFromJSON 导入 - 同名冲突', async () => {
      const existing = await getSimulators();
      const existingName = existing[0].name;

      const jsonWithConflict = {
        schemaVersion: 1,
        exportedAt: new Date(),
        exportedBy: 'someone',
        simulators: [{
          ...existing[0],
          id: generateId(),
          name: existingName,
        }],
      };

      const result = await importSimulatorsFromJSON(jsonWithConflict);

      assert.equal(result.imported.length, 0);
      assert.equal(result.skipped.length, 1);
      assert.equal(result.conflicts.length, 1);
      assert.equal(result.conflicts[0].type, 'name_exists');

      console.log('✅ 导入JSON（同名冲突）检测成功');
    });

    it('importSimulatorsFromJSON 导入 - 版本不兼容', async () => {
      const badJson = {
        schemaVersion: 999,
        exportedAt: new Date(),
        exportedBy: 'someone',
        simulators: [],
      };

      const result = await importSimulatorsFromJSON(badJson);
      assert.equal(result.imported.length, 0);
      assert.equal(result.conflicts.length, 1);
      assert.equal(result.conflicts[0].message.includes('版本不兼容'), true);

      console.log('✅ 导入版本不兼容JSON处理成功');
    });

    it('forceImportSimulator 强制导入 - 覆盖模式', async () => {
      const existing = await getSimulators();
      const toOverwrite = existing[0];
      const originalParams = { ...toOverwrite.params };

      const simToImport = {
        ...toOverwrite,
        id: generateId(),
        params: {
          ...toOverwrite.params,
          lateGracePeriodMinutes: 45,
        },
      };

      const result = await forceImportSimulator(simToImport, true, 'force_importer');

      assert.ok(result);
      assert.equal(result.id, toOverwrite.id);
      assert.equal(result.params.lateGracePeriodMinutes, 45);
      assert.equal(result.metadata.importedFrom, 'force-import');

      const restored = await updateSimulator({
        id: toOverwrite.id,
        params: originalParams,
        operator: toOverwrite.permissions.owner,
      });
      assert.ok(restored);

      console.log('✅ 强制导入（覆盖模式）成功');
    });

    it('forceImportSimulator 强制导入 - 自动重命名', async () => {
      const existing = await getSimulators();
      const toImport = existing[0];

      const simToImport = {
        ...toImport,
        id: generateId(),
        params: {
          ...toImport.params,
          earlyLeaveThresholdMinutes: 90,
        },
      };

      const result = await forceImportSimulator(simToImport, false, 'force_importer');

      assert.ok(result);
      assert.notEqual(result.id, toImport.id);
      assert.equal(result.name, `${toImport.name} (导入)`);
      assert.equal(result.params.earlyLeaveThresholdMinutes, 90);
      assert.equal(result.metadata.originalName, toImport.name);

      await deleteSimulator(result.id, result.permissions.owner);

      console.log('✅ 强制导入（自动重命名）成功');
    });
  });

  describe('6. 冲突检测和处理', () => {
    it('checkConflicts 检测批次统计版本变化', async () => {
      const result = await createSimulator({
        name: '冲突测试方案',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      const batch = await batchOperations.getById(testBatchId);
      if (batch) {
        batch.statsVersion = (batch.statsVersion || 0) + 10;
        await batchOperations.update(batch);
      }

      const conflicts = await checkConflicts(result.simulator.id);
      const versionConflict = conflicts.find(c => c.type === 'stats_version_mismatch');
      assert.ok(versionConflict);
      assert.equal(versionConflict.severity, 'warning');
      assert.ok(versionConflict.resolutionOptions.includes('reload'));

      if (batch) {
        batch.statsVersion = result.simulator.dataSnapshot.originalStatsVersion;
        await batchOperations.update(batch);
      }

      console.log('✅ 批次统计版本变化冲突检测成功');
    });

    it('checkConflicts 检测新检测结果', async () => {
      const result = await createSimulator({
        name: '检测结果变化测试',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      const fakeAnomaly: Anomaly = {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E999',
        type: 'late',
        severity: 'medium',
        description: '测试异常',
        status: 'pending',
        ruleVersionId: testRuleVersionId,
        scheduleDate: '2024-01-15',
        metadata: {},
        createdAt: new Date(),
      };
      await anomalyOperations.add(fakeAnomaly);

      const conflicts = await checkConflicts(result.simulator.id);
      const dataConflict = conflicts.find(c => c.type === 'new_detection_results');
      assert.ok(dataConflict);
      assert.equal(dataConflict.severity, 'warning');

      await anomalyOperations.update(fakeAnomaly);

      console.log('✅ 新检测结果冲突检测成功');
    });

    it('checkConflicts 检测规则版本回滚', async () => {
      const result = await createSimulator({
        name: '规则回滚测试',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      const originalRules = createDefaultRules();
      const rolledBackVersion = await createRuleVersion('回滚版本 (回滚)', originalRules, '回滚测试');
      await ruleVersionOperations.setActive(rolledBackVersion.id);

      const conflicts = await checkConflicts(result.simulator.id);
      const rollbackConflict = conflicts.find(c => c.type === 'rule_version_rolled_back');
      assert.ok(rollbackConflict);
      assert.equal(rollbackConflict.severity, 'warning');

      await ruleVersionOperations.setActive(testRuleVersionId);

      console.log('✅ 规则版本回滚冲突检测成功');
    });

    it('checkConflicts 检测已应用的模拟方案', async () => {
      const result1 = await createSimulator({
        name: '已应用测试-方案1',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result1.simulator);

      await runSimulation(result1.simulator.id);
      const applyResult = await applySimulator(result1.simulator.id, true, 'test_user');
      assert.equal(applyResult.success, true);

      const result2 = await createSimulator({
        name: '已应用测试-方案2',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result2.simulator);

      const conflicts = await checkConflicts(result2.simulator.id);
      const appliedConflict = conflicts.find(c => c.type === 'applied_simulator_exists');
      assert.ok(appliedConflict);
      assert.equal(appliedConflict.severity, 'error');
      assert.ok(appliedConflict.resolutionOptions.includes('overwrite'));

      await revertSimulator(result1.simulator.id, 'test_user');

      console.log('✅ 已应用模拟方案冲突检测成功');
    });

    it('saveSimulatorDraft 同名冲突要求确认', async () => {
      const result = await createSimulator({
        name: '草稿保存测试',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      const existing = await getSimulators();
      const otherSim = existing.find(s => s.id !== result.simulator!.id);
      assert.ok(otherSim);

      const draftToSave: Simulator = {
        ...result.simulator,
        name: otherSim.name,
      };

      const saveResult = await saveSimulatorDraft(draftToSave, false, 'test_user');

      assert.equal(saveResult.success, false);
      assert.equal(saveResult.requiresConfirmation, true);
      assert.ok(saveResult.conflicts);
      assert.ok(saveResult.conflicts.some(c => c.type === 'name_exists'));

      console.log('✅ 草稿保存同名冲突要求确认成功');
    });

    it('saveSimulatorDraft 覆盖同名草稿', async () => {
      const all = await getSimulators();
      const toOverwrite = all[0];

      const updatedDraft: Simulator = {
        ...toOverwrite,
        params: {
          ...toOverwrite.params,
          duplicatePunchWindowMinutes: 15,
        },
      };

      const saveResult = await saveSimulatorDraft(updatedDraft, true, toOverwrite.permissions.owner);

      assert.equal(saveResult.success, true);
      assert.equal(saveResult.requiresConfirmation, false);
      assert.ok(saveResult.simulator);
      assert.equal(saveResult.simulator.params.duplicatePunchWindowMinutes, 15);

      console.log('✅ 覆盖同名草稿成功');
    });
  });

  describe('7. 权限控制', () => {
    let testSimulator: Simulator;

    before(async () => {
      const result = await createSimulator({
        name: '权限测试方案',
        sourceBatchId: testBatchId,
        operator: 'owner_user',
      });
      assert.ok(result.simulator);
      testSimulator = result.simulator;

      testSimulator.permissions = {
        owner: 'owner_user',
        viewers: ['viewer_user'],
        editors: ['editor_user'],
      };
      await simulatorOperations.update(testSimulator);
    });

    it('checkPermission 所有者拥有所有权限', () => {
      const canEdit = checkPermission(testSimulator, 'owner_user', 'admin');
      const canView = checkPermission(testSimulator, 'owner_user', 'readonly');

      assert.equal(canEdit, true);
      assert.equal(canView, true);

      console.log('✅ 所有者权限验证成功');
    });

    it('checkPermission 编辑者拥有编辑和查看权限', () => {
      const canEdit = checkPermission(testSimulator, 'editor_user', 'admin');
      const canView = checkPermission(testSimulator, 'editor_user', 'readonly');

      assert.equal(canEdit, true);
      assert.equal(canView, true);

      console.log('✅ 编辑者权限验证成功');
    });

    it('checkPermission 查看者只有只读权限', () => {
      const canEdit = checkPermission(testSimulator, 'viewer_user', 'admin');
      const canView = checkPermission(testSimulator, 'viewer_user', 'readonly');

      assert.equal(canEdit, false);
      assert.equal(canView, true);

      console.log('✅ 查看者权限验证成功');
    });

    it('checkPermission 其他用户没有任何权限', () => {
      const canEdit = checkPermission(testSimulator, 'stranger_user', 'admin');
      const canView = checkPermission(testSimulator, 'stranger_user', 'readonly');

      assert.equal(canEdit, false);
      assert.equal(canView, false);

      console.log('✅ 其他用户权限验证成功');
    });

    it('无权限用户无法更新方案', async () => {
      await assert.rejects(
        async () => {
          await updateSimulator({
            id: testSimulator.id,
            name: '非法修改',
            operator: 'stranger_user',
          });
        },
        (err: Error) => err.message.includes('无编辑权限')
      );

      console.log('✅ 无权限用户无法更新方案验证成功');
    });

    it('无权限用户无法删除方案', async () => {
      await assert.rejects(
        async () => {
          await deleteSimulator(testSimulator.id, 'stranger_user');
        },
        (err: Error) => err.message.includes('无删除权限')
      );

      console.log('✅ 无权限用户无法删除方案验证成功');
    });
  });

  describe('8. 应用方案和撤销功能', () => {
    it('applySimulator 应用模拟方案生成新规则版本', async () => {
      const result = await createSimulator({
        name: '应用测试方案',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      await updateSimulator({
        id: result.simulator.id,
        params: {
          lateGracePeriodMinutes: 20,
          earlyLeaveThresholdMinutes: 90,
        },
        operator: 'test_user',
      });

      const simResult = await runSimulation(result.simulator.id);
      assert.ok(simResult);

      const beforeVersions = await ruleVersionOperations.getAll();
      const beforeMaxVersion = Math.max(...beforeVersions.map(v => v.version));

      const applyResult = await applySimulator(result.simulator.id, false, 'applier_user');

      assert.equal(applyResult.success, true);
      assert.equal(applyResult.requiresConfirmation, false);
      assert.ok(applyResult.simulator);
      assert.ok(applyResult.newRuleVersion);
      assert.equal(applyResult.simulator.status, 'applied');
      assert.ok(applyResult.simulator.appliedRuleVersionId);
      assert.equal(applyResult.simulator.appliedBy, 'applier_user');
      assert.ok(applyResult.simulator.appliedAt);
      assert.equal(applyResult.newRuleVersion.version, beforeMaxVersion + 1);
      assert.equal(applyResult.newRuleVersion.name, `模拟方案：应用测试方案`);
      assert.ok(applyResult.newRuleVersion.description.includes('迟到宽限20分钟'));

      const activeVersion = await ruleVersionOperations.getActive();
      assert.equal(activeVersion?.id, applyResult.newRuleVersion.id);

      const lateRule = applyResult.newRuleVersion.rules.find(r => r.anomalyType === 'late');
      assert.equal(lateRule?.params.gracePeriodMinutes, 20);

      const earlyRule = applyResult.newRuleVersion.rules.find(r => r.anomalyType === 'early_leave');
      assert.equal(earlyRule?.params.thresholdMinutes, 90);

      console.log('✅ 应用模拟方案生成新规则版本成功');
    });

    it('applySimulator 存在冲突时要求确认', async () => {
      const result1 = await createSimulator({
        name: '冲突应用测试-方案1',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result1.simulator);

      await runSimulation(result1.simulator.id);
      await applySimulator(result1.simulator.id, true, 'test_user');

      const result2 = await createSimulator({
        name: '冲突应用测试-方案2',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result2.simulator);

      await runSimulation(result2.simulator.id);
      const applyResult = await applySimulator(result2.simulator.id, false, 'test_user');

      assert.equal(applyResult.success, false);
      assert.equal(applyResult.requiresConfirmation, true);
      assert.ok(applyResult.conflicts);
      assert.ok(applyResult.conflicts.some(c => c.type === 'applied_simulator_exists'));

      await revertSimulator(result1.simulator.id, 'test_user');

      console.log('✅ 应用时存在冲突要求确认成功');
    });

    it('applySimulator 强制应用覆盖冲突', async () => {
      const result1 = await createSimulator({
        name: '强制应用测试-方案1',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result1.simulator);

      await runSimulation(result1.simulator.id);
      await applySimulator(result1.simulator.id, true, 'test_user');

      const result2 = await createSimulator({
        name: '强制应用测试-方案2',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result2.simulator);

      await runSimulation(result2.simulator.id);
      const applyResult = await applySimulator(result2.simulator.id, true, 'test_user');

      assert.equal(applyResult.success, true);
      assert.ok(applyResult.simulator);
      assert.equal(applyResult.simulator.status, 'applied');

      const revertedSim1 = await getSimulatorById(result1.simulator.id);
      assert.equal(revertedSim1?.status, 'reverted');

      await revertSimulator(result2.simulator.id, 'test_user');

      console.log('✅ 强制应用覆盖冲突成功');
    });

    it('revertSimulator 撤销已应用的方案', async () => {
      const result = await createSimulator({
        name: '撤销测试方案',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      await runSimulation(result.simulator.id);
      await applySimulator(result.simulator.id, true, 'applier_user');

      const appliedSim = await getSimulatorById(result.simulator.id);
      assert.equal(appliedSim?.status, 'applied');

      const revertResult = await revertSimulator(result.simulator.id, 'reverter_user');

      assert.equal(revertResult.success, true);
      assert.ok(revertResult.simulator);
      assert.equal(revertResult.simulator.status, 'reverted');
      assert.ok(revertResult.simulator.revertedFromRuleVersionId);
      assert.equal(revertResult.simulator.revertedBy, 'reverter_user');
      assert.ok(revertResult.simulator.revertedAt);
      assert.equal(revertResult.revertedToRuleVersionId, testRuleVersionId);

      const activeVersion = await ruleVersionOperations.getActive();
      assert.equal(activeVersion?.id, testRuleVersionId);

      console.log('✅ 撤销已应用的方案成功');
    });

    it('revertSimulator 无法撤销未应用的方案', async () => {
      const result = await createSimulator({
        name: '未应用撤销测试',
        sourceBatchId: testBatchId,
        operator: 'test_user',
      });
      assert.ok(result.simulator);

      const revertResult = await revertSimulator(result.simulator.id, 'test_user');

      assert.equal(revertResult.success, false);
      assert.equal(revertResult.message, '该模拟方案未处于已应用状态');

      console.log('✅ 无法撤销未应用的方案验证成功');
    });

    it('revertSimulator 无权限时无法撤销', async () => {
      const result = await createSimulator({
        name: '权限撤销测试',
        sourceBatchId: testBatchId,
        operator: 'owner_user',
      });
      assert.ok(result.simulator);

      await runSimulation(result.simulator.id);
      await applySimulator(result.simulator.id, true, 'owner_user');

      const revertResult = await revertSimulator(result.simulator.id, 'stranger_user');

      assert.equal(revertResult.success, false);
      assert.equal(revertResult.message, '无撤销权限');

      await revertSimulator(result.simulator.id, 'owner_user');

      console.log('✅ 无权限时无法撤销验证成功');
    });
  });

  describe('9. 审计日志记录', () => {
    let auditBatchId: string;

    before(async () => {
      await simulatorOperations.clear();
      const state = useAppStore.getState();
      const batch = await state.createBatch('模拟器审计测试批次');
      auditBatchId = batch.id;
      await state.selectBatch(auditBatchId);
    });

    it('创建模拟方案记录审计日志', async () => {
      const result = await useAppStore.getState().createSimulator({
        name: '审计测试方案',
        sourceBatchId: auditBatchId,
        operator: 'audit_user',
      });

      assert.equal(result.success, true);
      assert.ok(result.simulator);

      const timeline = await getBatchAuditTimeline(auditBatchId);
      const createLog = timeline.find(l => l.action === 'simulator_create');

      assert.ok(createLog);
      assert.equal(createLog.success, true);
      assert.equal(createLog.operator, 'audit_user');
      assert.equal(createLog.description.includes('审计测试方案'), true);
      assert.equal(createLog.metadata.simulatorId, result.simulator.id);
      assert.ok(createLog.metadata.params);

      console.log('✅ 创建模拟方案审计日志记录成功');
    });

    it('保存模拟方案记录审计日志', async () => {
      const all = await getSimulators(auditBatchId);
      const sim = all[0];

      const saveResult = await useAppStore.getState().saveSimulatorDraft(
        { ...sim, params: { ...sim.params, lateGracePeriodMinutes: 25 } },
        false,
        'audit_user'
      );

      assert.equal(saveResult.success, true);

      const timeline = await getBatchAuditTimeline(auditBatchId);
      const saveLog = timeline.find(l => l.action === 'simulator_save');

      assert.ok(saveLog);
      assert.equal(saveLog.description.includes('保存'), true);
      assert.equal(saveLog.metadata.newConfig.params.lateGracePeriodMinutes, 25);

      console.log('✅ 保存模拟方案审计日志记录成功');
    });

    it('应用模拟方案记录审计日志', async () => {
      const all = await getSimulators(auditBatchId);
      const sim = all[0];

      await useAppStore.getState().runSimulation(sim.id);
      const applyResult = await useAppStore.getState().applySimulator(sim.id, true, 'audit_user');

      assert.equal(applyResult.success, true);

      const timeline = await getBatchAuditTimeline(auditBatchId);
      const applyLog = timeline.find(l => l.action === 'simulator_apply');

      assert.ok(applyLog);
      assert.equal(applyLog.description.includes('应用'), true);
      assert.equal(applyLog.operator, 'audit_user');
      assert.ok(applyLog.metadata.ruleVersionId);
      assert.ok(applyLog.metadata.params);

      console.log('✅ 应用模拟方案审计日志记录成功');
    });

    it('撤销模拟方案记录审计日志', async () => {
      const all = await getSimulators(auditBatchId);
      const sim = all.find(s => s.status === 'applied');
      assert.ok(sim);

      const revertResult = await useAppStore.getState().revertSimulator(sim.id, 'audit_user');

      assert.equal(revertResult.success, true);

      const timeline = await getBatchAuditTimeline(auditBatchId);
      const revertLog = timeline.find(l => l.action === 'simulator_revert');

      assert.ok(revertLog);
      assert.equal(revertLog.description.includes('撤销'), true);
      assert.equal(revertLog.operator, 'audit_user');

      console.log('✅ 撤销模拟方案审计日志记录成功');
    });

    it('导入导出模拟方案记录审计日志', async () => {
      const exportResult = await useAppStore.getState().exportSimulatorsToJSON(undefined, 'audit_user');

      const timeline1 = await getBatchAuditTimeline(auditBatchId);
      const exportLog = timeline1.find(l => l.action === 'simulator_export');
      assert.ok(exportLog);
      assert.equal(exportLog.description.includes('导出'), true);

      const jsonToImport = {
        ...exportResult,
        simulators: exportResult.simulators.map(s => ({
          ...s,
          name: `审计导入${s.name}`,
        })),
      };

      const importResult = await useAppStore.getState().importSimulatorsFromJSON(jsonToImport, 'audit_user');
      assert.equal(importResult.imported.length, exportResult.simulators.length);

      const timeline2 = await getBatchAuditTimeline(auditBatchId);
      const importLogs = timeline2.filter(l => l.action === 'simulator_import');
      assert.equal(importLogs.length, exportResult.simulators.length);

      console.log('✅ 导入导出模拟方案审计日志记录成功');
    });

    it('删除模拟方案记录审计日志', async () => {
      const all = await getSimulators(auditBatchId);
      const toDelete = all.find(s => s.name.startsWith('审计导入'));
      assert.ok(toDelete);

      const result = await useAppStore.getState().deleteSimulator(toDelete.id, 'audit_user');
      assert.equal(result, true);

      const timeline = await getBatchAuditTimeline(auditBatchId);
      const deleteLog = timeline.find(l => l.action === 'simulator_delete');

      assert.ok(deleteLog);
      assert.equal(deleteLog.description.includes('删除'), true);
      assert.ok(deleteLog.metadata.deletedConfig);

      console.log('✅ 删除模拟方案审计日志记录成功');
    });

    it('完整操作时间线验证', async () => {
      const timeline = await getBatchAuditTimeline(auditBatchId);
      const actions = timeline.map(l => l.action);

      const expectedActions: AuditActionType[] = [
        'batch_create',
        'simulator_create',
        'simulator_save',
        'simulator_apply',
        'simulator_revert',
        'simulator_export',
        'simulator_import',
        'simulator_delete',
      ];

      expectedActions.forEach(action => {
        assert.equal(
          actions.includes(action),
          true,
          `时间线应该包含 ${action} 操作`
        );
      });

      const simulatorActions = timeline.filter(l => l.action.startsWith('simulator_'));
      assert.equal(simulatorActions.length >= 7, true);

      simulatorActions.forEach(log => {
        assert.ok(log.timestamp instanceof Date);
        assert.ok(log.operator);
        assert.ok(log.metadata.simulatorId);
      });

      console.log(`✅ 完整模拟器操作时间线验证通过，共 ${timeline.length} 条记录`);
    });
  });

  describe('10. Store 集成测试', () => {
    before(async () => {
      await simulatorOperations.clear();
      useAppStore.getState().simulators = [];
    });

    it('store.loadSimulators 加载数据', async () => {
      await createSimulator({
        name: 'Store集成测试1',
        sourceBatchId: testBatchId,
        operator: 'store_test',
      });

      await createSimulator({
        name: 'Store集成测试2',
        sourceBatchId: testBatchId,
        operator: 'store_test',
      });

      await useAppStore.getState().loadSimulators(testBatchId);

      const simulators = useAppStore.getState().simulators;
      assert.equal(simulators.length, 2);
      assert.ok(simulators.some(s => s.name === 'Store集成测试1'));
      assert.ok(simulators.some(s => s.name === 'Store集成测试2'));

      console.log('✅ store.loadSimulators 集成测试通过');
    });

    it('store.createSimulator 集成流程', async () => {
      const result = await useAppStore.getState().createSimulator({
        name: 'Store创建测试',
        sourceBatchId: testBatchId,
        operator: 'store_test',
      });

      assert.equal(result.success, true);
      assert.ok(result.simulator);

      const simulators = useAppStore.getState().simulators;
      assert.equal(simulators.length, 3);
      assert.ok(simulators.some(s => s.name === 'Store创建测试'));

      console.log('✅ store.createSimulator 集成测试通过');
    });

    it('store.runSimulation 集成流程', async () => {
      const simulators = useAppStore.getState().simulators;
      const sim = simulators.find(s => s.name === 'Store创建测试');
      assert.ok(sim);

      const result = await useAppStore.getState().runSimulation(sim.id);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(result.diff);
      assert.equal(result.simulator.status, 'ready');

      const updated = useAppStore.getState().simulators.find(s => s.id === sim.id);
      assert.equal(updated?.status, 'ready');
      assert.ok(updated?.simulationResult);

      console.log('✅ store.runSimulation 集成测试通过');
    });

    it('store.applySimulator 和 revertSimulator 集成流程', async () => {
      const simulators = useAppStore.getState().simulators;
      const sim = simulators.find(s => s.name === 'Store创建测试');
      assert.ok(sim);

      const applyResult = await useAppStore.getState().applySimulator(sim.id, true, 'store_test');
      assert.equal(applyResult.success, true);
      assert.ok(applyResult.newRuleVersion);

      const afterApply = useAppStore.getState().simulators.find(s => s.id === sim.id);
      assert.equal(afterApply?.status, 'applied');

      const ruleVersions = useAppStore.getState().ruleVersions;
      assert.ok(ruleVersions.some(v => v.id === applyResult.newRuleVersion?.id));

      const revertResult = await useAppStore.getState().revertSimulator(sim.id, 'store_test');
      assert.equal(revertResult.success, true);

      const afterRevert = useAppStore.getState().simulators.find(s => s.id === sim.id);
      assert.equal(afterRevert?.status, 'reverted');

      console.log('✅ store.applySimulator 和 revertSimulator 集成测试通过');
    });

    it('store.exportSimulatorsToJSON 和 importSimulatorsFromJSON 集成', async () => {
      const beforeCount = useAppStore.getState().simulators.length;

      const exportResult = await useAppStore.getState().exportSimulatorsToJSON();
      assert.ok(exportResult.simulators.length > 0);

      const jsonToImport = {
        ...exportResult,
        simulators: exportResult.simulators.map(s => ({
          ...s,
          name: `Store导入${s.name}`,
        })),
      };

      const importResult = await useAppStore.getState().importSimulatorsFromJSON(jsonToImport, 'store_test');
      assert.equal(importResult.imported.length, exportResult.simulators.length);

      const afterCount = useAppStore.getState().simulators.length;
      assert.equal(afterCount, beforeCount + importResult.imported.length);

      console.log('✅ store 导入导出集成测试通过');
    });
  });

  describe('11. generateSimulatorSummary 摘要生成', () => {
    it('为草稿状态生成摘要', async () => {
      const result = await createSimulator({
        name: '摘要测试草稿',
        sourceBatchId: testBatchId,
        operator: 'summary_user',
      });
      assert.ok(result.simulator);

      const summary = generateSimulatorSummary(result.simulator);

      assert.equal(summary.name, '摘要测试草稿');
      assert.equal(summary.status, 'draft');
      assert.equal(summary.sourceBatchName, result.simulator.sourceBatchName);
      assert.ok(summary.params);
      assert.ok(summary.originalAnomalies > 0);
      assert.equal(summary.simulatedAnomalies, undefined);
      assert.equal(summary.diff, undefined);
      assert.ok(summary.createdAt instanceof Date);
      assert.equal(summary.createdBy, 'summary_user');

      console.log('✅ 草稿状态摘要生成成功');
    });

    it('为已运行模拟的方案生成摘要', async () => {
      const all = await getSimulators();
      const sim = all.find(s => s.status === 'ready');
      assert.ok(sim, '需要一个已运行模拟的方案，请确保前面的测试通过');

      const summary = generateSimulatorSummary(sim);

      assert.equal(summary.status, 'ready');
      assert.ok(summary.simulatedAnomalies);
      assert.ok(summary.diff);
      assert.ok(typeof summary.diff.netChange === 'number');
      assert.ok(summary.diff.byType);

      console.log('✅ 已运行模拟的方案摘要生成成功');
    });

    it('为已应用的方案生成摘要', async () => {
      const result = await createSimulator({
        name: '摘要测试已应用',
        sourceBatchId: testBatchId,
        operator: 'summary_user',
      });
      assert.ok(result.simulator);

      await runSimulation(result.simulator.id);
      await applySimulator(result.simulator.id, true, 'summary_user');

      const applied = await getSimulatorById(result.simulator.id);
      assert.ok(applied);

      const summary = generateSimulatorSummary(applied);
      assert.equal(summary.status, 'applied');

      await revertSimulator(result.simulator.id, 'summary_user');

      console.log('✅ 已应用方案摘要生成成功');
    });
  });
});
