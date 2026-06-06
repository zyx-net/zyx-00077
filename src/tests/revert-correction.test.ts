import 'fake-indexeddb/auto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, clearDB, anomalyOperations, correctionOperations, batchOperations, scheduleOperations, punchOperations } from '../db';
import { correctAnomaly, revertCorrection, getBatchCorrections } from '../modules/correction';
import { calculateSummary } from '../modules/stats';
import { generateId, parseDateTime } from '../utils/dateUtils';
import type { Anomaly, ScheduleRecord, PunchRecord, Batch } from '../types';

describe('修正撤回回归测试 - 完整链路', () => {
  let testBatchId: string;
  let testAnomalies: Anomaly[] = [];

  const createTestAnomaly = (overrides: Partial<Anomaly> = {}): Anomaly => ({
    id: generateId(),
    batchId: testBatchId,
    employeeId: 'E001',
    employeeName: '张三',
    department: '技术部',
    type: 'late',
    severity: 'medium',
    description: '迟到 15 分钟，排班上班时间 09:00，实际打卡 09:15',
    status: 'pending',
    ruleVersionId: 'v1',
    scheduleDate: '2024-01-15',
    actualPunchIn: parseDateTime('2024-01-15 09:15:00'),
    scheduledStart: '09:00',
    durationMinutes: 15,
    metadata: {},
    createdAt: new Date(),
    matchedRecordId: 'm1',
    ...overrides,
  });

  const createTestSchedule = (overrides: Partial<ScheduleRecord> = {}): ScheduleRecord => ({
    id: generateId(),
    batchId: testBatchId,
    employeeId: 'E001',
    employeeName: '张三',
    department: '技术部',
    scheduleDate: '2024-01-15',
    startTime: '09:00',
    endTime: '18:00',
    shiftType: 'normal',
    ...overrides,
  });

  const createTestPunch = (overrides: Partial<PunchRecord> = {}): PunchRecord => ({
    id: generateId(),
    batchId: testBatchId,
    employeeId: 'E001',
    employeeName: '张三',
    punchTime: parseDateTime('2024-01-15 09:15:00'),
    punchType: 'in',
    deviceId: 'D001',
    timezone: 'Asia/Shanghai',
    ...overrides,
  });

  before(async () => {
    await initDB();
    await clearDB();

    testBatchId = generateId();
    const testBatch: Batch = {
      id: testBatchId,
      name: '撤回测试批次',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
      timezone: 'Asia/Shanghai',
      fieldMapping: { schedule: {}, punch: {}, leave: {} },
      stats: {
        totalSchedules: 2,
        totalPunches: 4,
        totalLeaves: 0,
        totalAnomalies: 3,
        pendingAnomalies: 3,
        correctedAnomalies: 0,
      },
    };
    await batchOperations.add(testBatch);

    testAnomalies = [
      createTestAnomaly({ id: 'a1', type: 'late', durationMinutes: 15 }),
      createTestAnomaly({ id: 'a2', type: 'early_leave', durationMinutes: 20, description: '早退 20 分钟' }),
      createTestAnomaly({ id: 'a3', type: 'missing_punch_out', description: '缺下班卡' }),
    ];
    await anomalyOperations.addMany(testAnomalies);

    const schedules = [
      createTestSchedule(),
      createTestSchedule({ employeeId: 'E002', employeeName: '李四' }),
    ];
    await scheduleOperations.addMany(schedules);

    const punches = [
      createTestPunch(),
      createTestPunch({ punchTime: parseDateTime('2024-01-15 17:40:00'), punchType: 'out' }),
    ];
    await punchOperations.addMany(punches);
  });

  after(async () => {
    await clearDB();
  });

  it('步骤1: 验证初始状态 - 3个待处理异常', async () => {
    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    assert.equal(anomalies.length, 3);
    
    const pending = anomalies.filter(a => a.status === 'pending');
    assert.equal(pending.length, 3);
    
    const summary = calculateSummary(anomalies);
    assert.equal(summary.totalAnomalies, 3);
    assert.equal(summary.pendingCorrections, 3);
    assert.equal(summary.correctedCount, 0);
    
    console.log('✅ 初始状态正确：3个待处理异常，0个已修正');
  });

  it('步骤2: 对2个异常进行人工修正', async () => {
    const result1 = await correctAnomaly('a1', 'mark_normal', {}, '考勤系统故障，实际正常');
    assert.equal(result1.success, true);
    assert.ok(result1.correction.id);
    
    const result2 = await correctAnomaly('a2', 'ignore', {}, '特殊情况，已报备主管');
    assert.equal(result2.success, true);
    assert.ok(result2.correction.id);

    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    const corrected = anomalies.filter(a => a.status === 'corrected');
    const ignored = anomalies.filter(a => a.status === 'ignored');
    
    assert.equal(corrected.length, 1);
    assert.equal(ignored.length, 1);
    assert.equal(anomalies.find(a => a.id === 'a1')?.correctionId, result1.correction.id);
    assert.equal(anomalies.find(a => a.id === 'a2')?.correctionId, result2.correction.id);

    const corrections = await getBatchCorrections(testBatchId);
    assert.equal(corrections.length, 2);

    const summary = calculateSummary(anomalies);
    assert.equal(summary.pendingCorrections, 1);
    assert.equal(summary.correctedCount, 1);
    assert.equal(summary.ignoredCount, 1);
    
    console.log('✅ 修正成功：1个已修正，1个已忽略，1个待处理');
  });

  it('步骤3: 验证修正后异常统计数据', async () => {
    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    const summary = calculateSummary(anomalies);
    const corrections = await getBatchCorrections(testBatchId);
    
    assert.equal(summary.totalAnomalies, 3);
    assert.equal(summary.pendingCorrections, 1);
    assert.equal(summary.correctedCount, 1);
    assert.equal(summary.ignoredCount, 1);
    assert.equal(corrections.length, 2);
    
    console.log('✅ 修正后统计正确：总3条，待处理1，已修正1，已忽略1，修正历史2条');
  });

  it('步骤4: 撤回第一个修正（标记为正常）', async () => {
    const corrections = await getBatchCorrections(testBatchId);
    const correctionToRevert = corrections.find(c => c.anomalyId === 'a1');
    assert.ok(correctionToRevert, '应该找到要撤回的修正记录');

    const revertResult = await revertCorrection(correctionToRevert!.id);
    assert.equal(revertResult, true, '撤回应该成功');

    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    const anomaly1 = anomalies.find(a => a.id === 'a1');
    
    assert.equal(anomaly1?.status, 'pending', '撤回后状态应恢复为 pending');
    assert.equal(anomaly1?.correctionId, undefined, '撤回后 correctionId 应清空');
    assert.equal(anomaly1?.correctedAt, undefined, '撤回后 correctedAt 应清空');
    assert.equal(anomaly1?.description, '迟到 15 分钟，排班上班时间 09:00，实际打卡 09:15', '撤回后描述应恢复原始内容');
    assert.equal(anomaly1?.durationMinutes, 15, '撤回后时长应恢复');

    const summary = calculateSummary(anomalies);
    assert.equal(summary.pendingCorrections, 2);
    assert.equal(summary.correctedCount, 0);
    assert.equal(summary.ignoredCount, 1);
    
    console.log('✅ 撤回第一个修正成功：状态恢复为 pending，异常数量恢复为待处理2，已修正0，已忽略1');
  });

  it('步骤5: 验证撤回后异常统计数据变化', async () => {
    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    const summary = calculateSummary(anomalies);
    
    assert.equal(summary.totalAnomalies, 3);
    assert.equal(summary.pendingCorrections, 2);
    assert.equal(summary.correctedCount, 0);
    assert.equal(summary.ignoredCount, 1);
    
    console.log('✅ 撤回后统计更新正确：待处理从1→2，已修正从1→0');
  });

  it('步骤6: 撤回第二个修正（忽略）', async () => {
    const corrections = await getBatchCorrections(testBatchId);
    const correctionToRevert = corrections.find(c => c.anomalyId === 'a2');
    assert.ok(correctionToRevert, '应该找到要撤回的修正记录');

    const revertResult = await revertCorrection(correctionToRevert!.id);
    assert.equal(revertResult, true, '撤回应该成功');

    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    
    const summary = calculateSummary(anomalies);
    assert.equal(summary.pendingCorrections, 3);
    assert.equal(summary.correctedCount, 0);
    assert.equal(summary.ignoredCount, 0);
    
    console.log('✅ 撤回第二个修正成功：所有3个异常恢复为待处理状态');
  });

  it('步骤7: 最终状态验证 - 完全恢复到初始状态', async () => {
    const anomalies = await anomalyOperations.getByBatchId(testBatchId);
    
    assert.equal(anomalies.length, 3);
    
    const allPending = anomalies.every(a => a.status === 'pending');
    assert.equal(allPending, true, '所有异常状态应为 pending');
    
    const noCorrectionIds = anomalies.every(a => !a.correctionId);
    assert.equal(noCorrectionIds, true, '所有异常不应有 correctionId');
    
    const noCorrectedAts = anomalies.every(a => !a.correctedAt);
    assert.equal(noCorrectedAts, true, '所有异常不应有 correctedAt');

    const summary = calculateSummary(anomalies);
    assert.equal(summary.totalAnomalies, 3);
    assert.equal(summary.pendingCorrections, 3);
    assert.equal(summary.correctedCount, 0);
    assert.equal(summary.ignoredCount, 0);
    
    console.log('✅ 最终状态正确：完全恢复到初始状态，3个待处理异常');
  });

  it('步骤8: 持久化历史验证 - 修正记录仍保留', async () => {
    const corrections = await getBatchCorrections(testBatchId);
    assert.equal(corrections.length, 2, '历史修正记录应保留，不会因撤回而删除');
    
    console.log('✅ 持久化历史正确：2条修正历史记录完整保留，可用于审计');
  });

  it('边界测试: 撤回不存在的 correctionId 应返回 false', async () => {
    const result = await revertCorrection('non-existent-id');
    assert.equal(result, false);
    console.log('✅ 边界测试通过：撤回不存在的记录返回 false');
  });
});
