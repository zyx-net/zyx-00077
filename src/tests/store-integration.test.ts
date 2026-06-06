import 'fake-indexeddb/auto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, clearDB, anomalyOperations, correctionOperations, batchOperations, scheduleOperations, punchOperations } from '../db';
import { correctAnomaly, revertCorrection, correctionModule } from '../modules/correction';
import { useAppStore } from '../store';
import { calculateSummary } from '../modules/stats';
import { generateId, parseDateTime } from '../utils/dateUtils';
import type { Anomaly, ScheduleRecord, PunchRecord, Batch, Correction } from '../types';

describe('Store 集成测试 - 状态同步验证', () => {
  let testBatchId: string;
  let testAnomalyIds: string[] = [];

  before(async () => {
    await initDB();
    await clearDB();

    const batch: Batch = {
      id: generateId(),
      name: 'Store集成测试批次',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
      timezone: 'Asia/Shanghai',
      fieldMapping: { schedule: {}, punch: {}, leave: {} },
      stats: { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 },
    };
    await batchOperations.add(batch);
    testBatchId = batch.id;

    const schedule: ScheduleRecord = {
      id: generateId(),
      batchId: testBatchId,
      employeeId: 'E001',
      employeeName: '张三',
      department: '技术部',
      scheduleDate: '2024-01-15',
      startTime: '09:00',
      endTime: '18:00',
      shiftType: 'normal',
      createdAt: new Date(),
    };
    await scheduleOperations.addMany([schedule]);

    const punch: PunchRecord = {
      id: generateId(),
      batchId: testBatchId,
      employeeId: 'E001',
      punchTime: parseDateTime('2024-01-15 09:15:00', 'Asia/Shanghai'),
      punchType: 'in',
      timezone: 'Asia/Shanghai',
      createdAt: new Date(),
    };
    await punchOperations.addMany([punch]);

    const anomalies: Anomaly[] = [
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        department: '技术部',
        scheduleDate: '2024-01-15',
        type: 'late',
        severity: 'medium',
        status: 'pending',
        description: '迟到15分钟（应到09:00，实到09:15）',
        durationMinutes: 15,
        scheduledStart: '09:00',
        scheduledEnd: '18:00',
        actualPunchIn: parseDateTime('2024-01-15 09:15:00', 'Asia/Shanghai'),
        ruleVersionId: 'v1',
        metadata: {},
        createdAt: new Date(),
      },
      {
        id: generateId(),
        batchId: testBatchId,
        employeeId: 'E001',
        employeeName: '张三',
        department: '技术部',
        scheduleDate: '2024-01-15',
        type: 'early_leave',
        severity: 'medium',
        status: 'pending',
        description: '早退15分钟（应到18:00，实到17:45）',
        durationMinutes: 15,
        scheduledStart: '09:00',
        scheduledEnd: '18:00',
        actualPunchOut: parseDateTime('2024-01-15 17:45:00', 'Asia/Shanghai'),
        ruleVersionId: 'v1',
        metadata: {},
        createdAt: new Date(),
      },
    ];

    await anomalyOperations.addMany(anomalies);
    testAnomalyIds = anomalies.map(a => a.id);

    useAppStore.getState().clearCurrentBatchData();
    await useAppStore.getState().selectBatch(testBatchId);
  });

  after(async () => {
    await clearDB();
    useAppStore.getState().clearCurrentBatchData();
  });

  it('初始状态：store 中 anomalies 和 corrections 正确加载', () => {
    const state = useAppStore.getState();
    assert.equal(state.anomalies.length, 2);
    assert.equal(state.corrections.length, 0);
    assert.equal(state.currentBatchId, testBatchId);

    const summary = calculateSummary(state.anomalies);
    assert.equal(summary.totalAnomalies, 2);
    assert.equal(summary.pendingCorrections, 2);
    assert.equal(summary.correctedCount, 0);

    console.log('✅ 初始状态正确：2个待处理异常，0个修正记录');
  });

  it('创建修正后：通过 selectBatch 重新加载验证状态', async () => {
    const anomalyId = testAnomalyIds[0];

    const result = await correctAnomaly(anomalyId, 'mark_normal', {}, '系统误报，实际正常');
    assert.equal(result.success, true);

    await useAppStore.getState().selectBatch(testBatchId);
    const newState = useAppStore.getState();
    assert.equal(newState.anomalies.length, 2);
    assert.equal(newState.corrections.length, 1);

    const updatedAnomaly = newState.anomalies.find(a => a.id === anomalyId);
    assert.equal(updatedAnomaly?.status, 'corrected');
    assert.ok(updatedAnomaly?.correctionId);
    assert.ok(updatedAnomaly?.correctedAt);
    assert.ok(updatedAnomaly?.description.startsWith('已标记为正常'));

    const summary = calculateSummary(newState.anomalies);
    assert.equal(summary.pendingCorrections, 1);
    assert.equal(summary.correctedCount, 1);

    console.log('✅ 修正后状态正确：待处理1，已修正1，修正记录1条');
  });

  it('store.revertCorrection 撤回后：状态正确同步', async () => {
    await useAppStore.getState().selectBatch(testBatchId);
    const currentState = useAppStore.getState();
    assert.equal(currentState.corrections.length, 1);
    const correction = currentState.corrections[0];
    const anomalyId = correction.anomalyId;

    const success = await useAppStore.getState().revertCorrection(correction.id);
    assert.equal(success, true);

    const newState = useAppStore.getState();
    assert.equal(newState.anomalies.length, 2);
    assert.equal(newState.corrections.length, 1);

    const revertedAnomaly = newState.anomalies.find(a => a.id === anomalyId);
    assert.equal(revertedAnomaly?.status, 'pending');
    assert.equal(revertedAnomaly?.correctionId, undefined);
    assert.equal(revertedAnomaly?.correctedAt, undefined);
    assert.ok(!revertedAnomaly?.description.startsWith('已标记为正常'));
    assert.ok(revertedAnomaly?.description.includes('迟到15分钟'));

    const summary = calculateSummary(newState.anomalies);
    assert.equal(summary.pendingCorrections, 2);
    assert.equal(summary.correctedCount, 0);

    console.log('✅ store.revertCorrection 状态同步正确：待处理2，已修正0，历史记录保留1条');
  });

  it('多次修正撤回循环：状态始终一致', async () => {
    const anomalyId = testAnomalyIds[1];

    for (let i = 0; i < 3; i++) {
      const result = await correctAnomaly(anomalyId, 'ignore', {}, `测试忽略第${i + 1}次`);
      assert.equal(result.success, true);

      await useAppStore.getState().selectBatch(testBatchId);
      let checkState = useAppStore.getState();
      let anomaly = checkState.anomalies.find(a => a.id === anomalyId);
      assert.equal(anomaly?.status, 'ignored');

      const success = await useAppStore.getState().revertCorrection(result.correction.id);
      assert.equal(success, true);

      checkState = useAppStore.getState();
      anomaly = checkState.anomalies.find(a => a.id === anomalyId);
      assert.equal(anomaly?.status, 'pending');
    }

    await useAppStore.getState().selectBatch(testBatchId);
    const finalState = useAppStore.getState();
    assert.equal(finalState.corrections.length, 4);
    const summary = calculateSummary(finalState.anomalies);
    assert.equal(summary.pendingCorrections, 2);
    assert.equal(summary.ignoredCount, 0);

    console.log('✅ 3次修正撤回循环验证通过：状态始终一致，历史记录累计4条');
  });

  it('批量修正后批量撤回：统计数据正确更新', async () => {
    for (const anomalyId of testAnomalyIds) {
      const result = await correctAnomaly(anomalyId, 'confirm', {}, '确认异常属实');
      assert.equal(result.success, true);
    }

    await useAppStore.getState().selectBatch(testBatchId);
    let midState = useAppStore.getState();
    let summary = calculateSummary(midState.anomalies);
    assert.equal(summary.pendingCorrections, 0);
    assert.equal(summary.correctedCount, 0);
    assert.equal(summary.ignoredCount, 0);
    assert.equal(midState.anomalies.filter(a => a.status === 'confirmed').length, 2);

    console.log('✅ 批量修正后：2个已确认，0个待处理');

    midState = useAppStore.getState();
    for (const anomaly of midState.anomalies) {
      if (anomaly.correctionId) {
        const success = await useAppStore.getState().revertCorrection(anomaly.correctionId);
        assert.equal(success, true);
      }
    }

    const finalState = useAppStore.getState();
    summary = calculateSummary(finalState.anomalies);
    assert.equal(summary.pendingCorrections, 2);
    assert.equal(finalState.anomalies.every(a => a.status === 'pending'), true);

    console.log('✅ 批量撤回后：2个待处理，状态完全恢复');
  });

  it('跨批次隔离：撤回不影响其他批次数据', async () => {
    const otherBatch: Batch = {
      id: generateId(),
      name: '其他批次',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
      timezone: 'Asia/Shanghai',
      fieldMapping: { schedule: {}, punch: {}, leave: {} },
      stats: { totalSchedules: 0, totalPunches: 0, totalLeaves: 0, totalAnomalies: 0, pendingAnomalies: 0, correctedAnomalies: 0 },
    };
    await batchOperations.add(otherBatch);

    const otherAnomaly: Anomaly = {
      id: generateId(),
      batchId: otherBatch.id,
      employeeId: 'E002',
      employeeName: '李四',
      department: '市场部',
      scheduleDate: '2024-01-16',
      type: 'late',
      severity: 'low',
      status: 'pending',
      description: '迟到5分钟',
      durationMinutes: 5,
      scheduledStart: '09:00',
      scheduledEnd: '18:00',
      ruleVersionId: 'v1',
      metadata: {},
      createdAt: new Date(),
    };
    await anomalyOperations.addMany([otherAnomaly]);

    await useAppStore.getState().selectBatch(otherBatch.id);
    let otherState = useAppStore.getState();
    assert.equal(otherState.anomalies.length, 1);
    assert.equal(otherState.anomalies[0].status, 'pending');

    await useAppStore.getState().selectBatch(testBatchId);
    let mainState = useAppStore.getState();
    assert.equal(mainState.anomalies.length, 2);

    console.log('✅ 批次隔离验证通过：不同批次数据互不影响');
  });

  it('刚修正后立即撤回：corrections 状态同步，无需重新加载', async () => {
    const state = useAppStore.getState();
    await state.selectBatch(testBatchId);

    const initialAnomalies = useAppStore.getState().anomalies;
    const anomalyToCorrect = initialAnomalies.find(a => a.status === 'pending');
    if (!anomalyToCorrect) {
      console.log('⚠️  没有待处理异常，跳过此测试');
      return;
    }

    const initialCorrectionsCount = useAppStore.getState().corrections.length;
    const initialPendingCount = useAppStore.getState().anomalies.filter(a => a.status === 'pending').length;

    console.log(`✅ 初始状态：${initialPendingCount}个待处理，${initialCorrectionsCount}条修正记录`);

    const result = await correctionModule.correctAnomaly(
      anomalyToCorrect.id,
      'mark_normal',
      {},
      '测试修正后立即撤回'
    );

    assert.ok(result.success);
    assert.ok(result.updatedAnomaly);
    assert.ok(result.correction);

    await state.updateAnomaly(result.updatedAnomaly);
    await state.addCorrection(result.correction);

    let s2 = useAppStore.getState();
    const afterPendingCount = s2.anomalies.filter(a => a.status === 'pending').length;
    const afterCorrectedCount = s2.anomalies.filter(a => a.status === 'corrected').length;
    const afterCorrectionsCount = s2.corrections.length;

    assert.equal(afterPendingCount, initialPendingCount - 1);
    assert.equal(afterCorrectedCount, 1);
    assert.equal(afterCorrectionsCount, initialCorrectionsCount + 1);
    assert.ok(result.updatedAnomaly.correctionId, '异常应该有 correctionId');
    assert.equal(
      s2.corrections.find(c => c.id === result.correction!.id)?.id,
      result.correction.id,
      'corrections 数组应包含最新记录'
    );
    console.log(`✅ 修正后状态正确：${afterPendingCount}个待处理，${afterCorrectedCount}个已修正，${afterCorrectionsCount}条修正记录`);

    const foundCorrection = s2.corrections.find(c => c.id === result.updatedAnomaly!.correctionId);
    assert.ok(foundCorrection, '应该能从 corrections 数组中找到最新记录，无需重新加载');
    console.log(`✅ 立即查找验证：无需重新加载即可找到最新修正记录`);

    const revertSuccess = await state.revertCorrection(result.correction.id);
    assert.ok(revertSuccess, '刚修正后立即撤回应该成功');

    let s3 = useAppStore.getState();
    const revertPendingCount = s3.anomalies.filter(a => a.status === 'pending').length;
    const revertCorrectedCount = s3.anomalies.filter(a => a.status === 'corrected').length;
    assert.equal(revertPendingCount, initialPendingCount);
    assert.equal(revertCorrectedCount, 0);
    assert.equal(s3.corrections.length, initialCorrectionsCount + 1, '撤回后历史记录仍保留');
    console.log(`✅ 撤回成功：${revertPendingCount}个待处理，${revertCorrectedCount}个已修正，历史记录保留`);
  });

  it('批量修正后立即批量撤回：状态同步验证', async () => {
    const state = useAppStore.getState();
    await state.selectBatch(testBatchId);

    const initialAnomalies = useAppStore.getState().anomalies;
    const pendingAnomalies = initialAnomalies.filter(a => a.status === 'pending');

    if (pendingAnomalies.length < 2) {
      console.log('⚠️  待处理异常不足2个，跳过此测试');
      return;
    }

    const anomalyIds = pendingAnomalies.slice(0, 2).map(a => a.id);
    const initialCorrectionsCount = useAppStore.getState().corrections.length;
    const initialPendingCount = pendingAnomalies.length;

    console.log(`✅ 初始状态：${initialPendingCount}个待处理，${initialCorrectionsCount}条历史记录`);

    const results = await correctionModule.batchCorrect(
      anomalyIds,
      'confirm',
      {},
      '批量确认异常'
    );

    const updatedAnomalies: Anomaly[] = [];
    const newCorrections: Correction[] = [];

    for (const r of results) {
      if (r.success && r.updatedAnomaly && r.correction) {
        updatedAnomalies.push(r.updatedAnomaly);
        newCorrections.push(r.correction);
      }
    }

    assert.equal(updatedAnomalies.length, 2);
    assert.equal(newCorrections.length, 2);

    await state.updateAnomalies(updatedAnomalies);
    for (const c of newCorrections) {
      await state.addCorrection(c);
    }

    let s2 = useAppStore.getState();
    const afterConfirmedCount = s2.anomalies.filter(a => a.status === 'confirmed').length;
    const afterPendingCount = s2.anomalies.filter(a => a.status === 'pending').length;
    const afterCorrectionsCount = s2.corrections.length;

    assert.equal(afterConfirmedCount, 2);
    assert.equal(afterPendingCount, initialPendingCount - 2);
    assert.equal(afterCorrectionsCount, initialCorrectionsCount + 2);
    console.log(`✅ 批量修正后：${afterConfirmedCount}个已确认，${afterPendingCount}个待处理，共${afterCorrectionsCount}条记录`);

    for (const anomaly of updatedAnomalies) {
      const found = s2.corrections.find(c => c.id === anomaly.correctionId);
      assert.ok(found, `批量修正后 ${anomaly.id} 应该能立即找到对应修正记录`);
    }
    console.log(`✅ 批量修正后所有异常都能立即找到修正记录`);

    for (const c of newCorrections) {
      await state.revertCorrection(c.id);
    }

    let s3 = useAppStore.getState();
    const finalPendingCount = s3.anomalies.filter(a => a.status === 'pending').length;
    const finalConfirmedCount = s3.anomalies.filter(a => a.status === 'confirmed').length;
    assert.equal(finalPendingCount, initialPendingCount);
    assert.equal(finalConfirmedCount, 0);
    assert.equal(s3.corrections.length, initialCorrectionsCount + 2, '所有历史记录保留');
    console.log(`✅ 批量撤回后：${finalPendingCount}个待处理，${finalConfirmedCount}个已确认，共${s3.corrections.length}条历史记录`);
  });

  it('撤回修正后 batch.stats 持久化回写：修正→撤回→重新读取批次→统计一致', async () => {
    const state = useAppStore.getState();
    await state.selectBatch(testBatchId);

    const initialAnomalies = useAppStore.getState().anomalies;
    const pendingAnomalies = initialAnomalies.filter(a => a.status === 'pending');

    if (pendingAnomalies.length === 0) {
      console.log('⚠️  没有待处理异常，跳过此测试');
      return;
    }

    const anomalyToCorrect = pendingAnomalies[0];

    let initialBatch = await batchOperations.getById(testBatchId);
    assert.ok(initialBatch, '批次应该存在');

    const initialPending = initialBatch.stats.pendingAnomalies;
    const initialCorrected = initialBatch.stats.correctedAnomalies;
    console.log(`✅ 初始持久化统计：待处理=${initialPending}, 已修正=${initialCorrected}`);

    const result = await correctionModule.correctAnomaly(
      anomalyToCorrect.id,
      'mark_normal',
      {},
      '测试batch.stats回写'
    );

    assert.ok(result.success);
    assert.ok(result.updatedAnomaly);
    assert.ok(result.correction);

    await state.updateAnomaly(result.updatedAnomaly);
    await state.addCorrection(result.correction);

    let batchAfterCorrect = await batchOperations.getById(testBatchId);
    assert.ok(batchAfterCorrect, '批次应该存在');
    assert.equal(batchAfterCorrect.stats.pendingAnomalies, initialPending - 1,
      '修正后持久化 pending 应该减 1');
    assert.equal(batchAfterCorrect.stats.correctedAnomalies, initialCorrected + 1,
      '修正后持久化 corrected 应该加 1');
    console.log(`✅ 修正后持久化统计：待处理=${batchAfterCorrect.stats.pendingAnomalies}, 已修正=${batchAfterCorrect.stats.correctedAnomalies}`);

    const revertSuccess = await state.revertCorrection(result.correction.id);
    assert.ok(revertSuccess, '撤回应该成功');

    let batchAfterRevert = await batchOperations.getById(testBatchId);
    assert.ok(batchAfterRevert, '批次应该存在');
    assert.equal(batchAfterRevert.stats.pendingAnomalies, initialPending,
      '撤回后持久化 pending 应该恢复原值');
    assert.equal(batchAfterRevert.stats.correctedAnomalies, initialCorrected,
      '撤回后持久化 corrected 应该恢复原值');
    console.log(`✅ 撤回后持久化统计：待处理=${batchAfterRevert.stats.pendingAnomalies}, 已修正=${batchAfterRevert.stats.correctedAnomalies}`);

    await state.selectBatch(testBatchId);
    let sAfterReload = useAppStore.getState();
    const storePending = sAfterReload.anomalies.filter(a => a.status === 'pending').length;
    const storeCorrected = sAfterReload.anomalies.filter(a => 
      a.status === 'corrected' || a.status === 'ignored' || a.status === 'confirmed'
    ).length;

    assert.equal(storePending, initialPending,
      '重新加载后 store pending 应该与持久化一致');
    assert.equal(storeCorrected, initialCorrected,
      '重新加载后 store corrected 应该与持久化一致');
    assert.equal(batchAfterRevert.stats.pendingAnomalies, storePending,
      '持久化 pending 应该与 store 一致');
    assert.equal(batchAfterRevert.stats.correctedAnomalies, storeCorrected,
      '持久化 corrected 应该与 store 一致');
    console.log(`✅ 重新加载批次后一致：store待处理=${storePending}, 持久化待处理=${batchAfterRevert.stats.pendingAnomalies}`);

    const summary = calculateSummary(sAfterReload.anomalies);
    assert.equal(summary.totalAnomalies, batchAfterRevert.stats.totalAnomalies,
      '导出统计 total 应该与持久化一致');
    assert.equal(summary.pendingCorrections, batchAfterRevert.stats.pendingAnomalies,
      '导出统计 pending 应该与持久化一致');
    assert.equal(summary.correctedCount + summary.ignoredCount + summary.confirmedCount, batchAfterRevert.stats.correctedAnomalies,
      '导出统计 corrected 应该与持久化一致');
    console.log(`✅ 导出统计与持久化一致：total=${summary.totalAnomalies}, pending=${summary.pendingCorrections}, corrected=${summary.correctedCount + summary.ignoredCount + summary.confirmedCount}`);
  });
});
