import 'fake-indexeddb/auto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDB,
  clearDB,
  anomalyOperations,
  correctionOperations,
  batchOperations,
  appealOperations,
} from '../db';
import { useAppStore } from '../store';
import appealModule, {
  canTransition,
  checkConflicts,
  checkReviewConflicts,
  createAppeal,
  approveAppeal,
  rejectAppeal,
  revokeAppeal,
  generateAppealCSV,
  VALID_TRANSITIONS,
  APPEAL_STATUS_LABELS,
} from '../modules/appeal';
import auditModule from '../modules/audit';
import { generateId, parseDateTime } from '../utils/dateUtils';
import type {
  Anomaly,
  Batch,
  AppealStatus,
  AppealConflictType,
} from '../types';

describe('异常申诉模块测试', () => {
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

  const createTestAnomalies = async (batchId: string, count: number = 5): Promise<Anomaly[]> => {
    const anomalies: Anomaly[] = [];
    const types: Array<'late' | 'early_leave' | 'missing_punch' | 'missing_punch_in' | 'missing_punch_out'> =
      ['late', 'early_leave', 'missing_punch', 'missing_punch_in', 'missing_punch_out'];
    
    for (let i = 0; i < count; i++) {
      anomalies.push({
        id: generateId(),
        batchId,
        employeeId: `E00${i + 1}`,
        employeeName: `员工${i + 1}`,
        department: i % 2 === 0 ? '技术部' : '产品部',
        scheduleDate: `2024-01-${15 + i}`,
        type: types[i % types.length],
        severity: 'medium',
        status: 'pending',
        description: `${types[i % types.length]} ${i + 1}`,
        durationMinutes: 15 * (i + 1),
        scheduledStart: '09:00',
        scheduledEnd: '18:00',
        actualPunchIn: i % 2 === 0 ? parseDateTime(`2024-01-${15 + i} 09:15:00`, 'Asia/Shanghai') : undefined,
        actualPunchOut: i % 2 === 1 ? parseDateTime(`2024-01-${15 + i} 17:45:00`, 'Asia/Shanghai') : undefined,
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

  describe('1. 核心状态机测试', () => {
    it('状态机定义正确', () => {
      assert.deepEqual(VALID_TRANSITIONS.pending, ['approved', 'rejected', 'revoked']);
      assert.deepEqual(VALID_TRANSITIONS.approved, []);
      assert.deepEqual(VALID_TRANSITIONS.rejected, []);
      assert.deepEqual(VALID_TRANSITIONS.revoked, []);
      assert.equal(Object.keys(VALID_TRANSITIONS).length, 4);
    });

    it('状态标签定义完整', () => {
      assert.equal(APPEAL_STATUS_LABELS.pending, '待处理');
      assert.equal(APPEAL_STATUS_LABELS.approved, '已通过');
      assert.equal(APPEAL_STATUS_LABELS.rejected, '已驳回');
      assert.equal(APPEAL_STATUS_LABELS.revoked, '已撤销');
    });

    it('canTransition 验证合法的状态流转', () => {
      assert.equal(canTransition('pending', 'approved'), true);
      assert.equal(canTransition('pending', 'rejected'), true);
      assert.equal(canTransition('pending', 'revoked'), true);
    });

    it('canTransition 阻止非法的状态流转', () => {
      assert.equal(canTransition('pending', 'pending'), false);
      assert.equal(canTransition('approved', 'rejected'), false);
      assert.equal(canTransition('approved', 'revoked'), false);
      assert.equal(canTransition('rejected', 'approved'), false);
      assert.equal(canTransition('revoked', 'approved'), false);
      assert.equal(canTransition('rejected', 'pending'), false);
    });

    it('终止状态没有出边', () => {
      const terminalStates: AppealStatus[] = ['approved', 'rejected', 'revoked'];
      for (const state of terminalStates) {
        for (const target of ['pending', 'approved', 'rejected', 'revoked']) {
          assert.equal(
            canTransition(state, target as AppealStatus),
            false,
            `${state} 不应该能流转到 ${target}`
          );
        }
      }
    });

    console.log('✅ 核心状态机测试通过');
  });

  describe('2. 冲突检测测试', () => {
    let conflictBatchId: string;
    let conflictAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('冲突检测测试批次', 1);
      conflictBatchId = batch.id;
      conflictAnomalies = await createTestAnomalies(conflictBatchId, 5);
      
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
      await useAppStore.getState().selectBatch(conflictBatchId);
    });

    it('正常异常无冲突可申诉', async () => {
      const conflicts = await checkConflicts(conflictAnomalies[0].id);
      assert.equal(conflicts.length, 0);
      console.log('✅ 正常异常无冲突检测通过');
    });

    it('检测到已存在待处理申诉冲突', async () => {
      const anomalyId = conflictAnomalies[1].id;
      
      await createAppeal({
        anomalyId,
        reason: '测试申诉',
        evidence: [],
      });

      const conflicts = await checkConflicts(anomalyId);
      
      const pendingConflict = conflicts.find(c => c.type === 'pending_appeal_exists');
      assert.ok(pendingConflict);
      assert.equal(pendingConflict.message.includes('该异常已有待处理的申诉'), true);
      assert.equal(pendingConflict.severity, 'error');

      console.log('✅ 待处理申诉冲突检测通过');
    });

    it('检测到异常已被修正冲突', async () => {
      const anomalyId = conflictAnomalies[2].id;
      
      const anomaly = await anomalyOperations.getById(anomalyId);
      if (anomaly) {
        anomaly.status = 'corrected';
        await anomalyOperations.update(anomaly);
      }

      const conflicts = await checkConflicts(anomalyId);
      
      const correctedConflict = conflicts.find(c => c.type === 'anomaly_already_corrected');
      assert.ok(correctedConflict);
      assert.equal(correctedConflict.message.includes('该异常已被修正'), true);
      assert.equal(correctedConflict.severity, 'error');

      console.log('✅ 异常已修正冲突检测通过');
    });

    it('检测到批次已删除冲突', async () => {
      const nonExistentAnomalyId = generateId();
      
      const conflicts = await checkConflicts(nonExistentAnomalyId);
      
      const notFoundConflict = conflicts.find(c => c.type === 'anomaly_not_found');
      assert.ok(notFoundConflict);
      assert.equal(notFoundConflict.message.includes('异常不存在'), true);
      assert.equal(notFoundConflict.severity, 'error');

      console.log('✅ 异常不存在冲突检测通过');
    });

    it('检测到批次已删除（异常存在但批次不存在）', async () => {
      const tempBatch = await createTestBatch('临时批次', 1);
      const tempAnomalies = await createTestAnomalies(tempBatch.id, 1);
      
      const anomaly = tempAnomalies[0];
      anomaly.batchId = 'non-existent-batch-id';
      await anomalyOperations.update(anomaly);
      
      await batchOperations.delete(tempBatch.id);
      
      const conflicts = await checkConflicts(anomaly.id);
      
      const batchDeletedConflict = conflicts.find(c => c.type === 'batch_deleted');
      assert.ok(batchDeletedConflict);
      assert.equal(batchDeletedConflict.message.includes('批次已被删除'), true);
      assert.equal(batchDeletedConflict.severity, 'error');

      console.log('✅ 批次已删除冲突检测通过');
    });

    it('审批时检测到无效状态流转冲突', async () => {
      const anomalyId = conflictAnomalies[3].id;
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '审批冲突测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      await approveAppeal({
        appealId: createResult.appeal.id,
        comment: '通过',
      });
      
      const reviewConflicts = await checkReviewConflicts(createResult.appeal.id, 'approved');
      
      const invalidTransitionConflict = reviewConflicts.find(c => c.type === 'invalid_state_transition');
      assert.ok(invalidTransitionConflict);
      assert.equal(invalidTransitionConflict.message.includes('状态流转无效'), true);

      console.log('✅ 审批状态流转冲突检测通过');
    });

    it('审批时检测到异常已被修正冲突', async () => {
      const anomalyId = conflictAnomalies[4].id;
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '审批修正冲突测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const anomaly = await anomalyOperations.getById(anomalyId);
      if (anomaly) {
        anomaly.status = 'corrected';
        await anomalyOperations.update(anomaly);
      }
      
      const reviewConflicts = await checkReviewConflicts(createResult.appeal.id, 'approved');
      
      const correctedConflict = reviewConflicts.find(c => c.type === 'anomaly_already_corrected');
      assert.ok(correctedConflict);
      assert.equal(correctedConflict.message.includes('异常已被修正'), true);

      console.log('✅ 审批时异常已修正冲突检测通过');
    });
  });

  describe('3. 申诉创建与持久化测试', () => {
    let persistenceBatchId: string;
    let persistenceAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('持久化测试批次', 1);
      persistenceBatchId = batch.id;
      persistenceAnomalies = await createTestAnomalies(persistenceBatchId, 6);
      
      batch.stats = {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 6,
        pendingAnomalies: 6,
        correctedAnomalies: 0,
      };
      await batchOperations.update(batch);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(persistenceBatchId);
    });

    it('创建申诉成功并持久化', async () => {
      const anomalyId = persistenceAnomalies[0].id;
      
      const result = await createAppeal({
        anomalyId,
        reason: '测试申诉原因',
        correctionType: 'mark_normal',
        correctionValue: {},
        evidence: [
          {
            type: 'note',
            name: '补充说明',
            description: '这是详细的说明',
            uploadedBy: '测试用户',
          },
        ],
      });

      assert.equal(result.success, true);
      assert.ok(result.appeal);
      assert.equal(result.appeal.status, 'pending');
      assert.equal(result.appeal.reason, '测试申诉原因');
      assert.equal(result.appeal.evidence.length, 1);
      assert.equal(result.appeal.evidence[0].description, '这是详细的说明');

      const savedAppeal = await appealOperations.getById(result.appeal.id);
      assert.ok(savedAppeal);
      assert.equal(savedAppeal.id, result.appeal.id);
      assert.equal(savedAppeal.reason, '测试申诉原因');
      assert.equal(savedAppeal.status, 'pending');

      console.log('✅ 创建申诉并持久化测试通过');
    });

    it('申诉与批次、异常正确关联', async () => {
      const anomalyId = persistenceAnomalies[1].id;
      
      const result = await createAppeal({
        anomalyId,
        reason: '关联测试申诉',
        evidence: [],
      });

      assert.ok(result.success && result.appeal);
      assert.equal(result.appeal.batchId, persistenceBatchId);
      assert.equal(result.appeal.anomalyId, anomalyId);
      assert.equal(result.appeal.employeeId, persistenceAnomalies[1].employeeId);
      assert.equal(result.appeal.employeeName, persistenceAnomalies[1].employeeName);
      assert.equal(result.appeal.department, persistenceAnomalies[1].department);
      assert.equal(result.appeal.scheduleDate, persistenceAnomalies[1].scheduleDate);
      assert.equal(result.appeal.anomalyType, persistenceAnomalies[1].type);

      console.log('✅ 申诉关联测试通过');
    });

    it('按批次查询申诉', async () => {
      const appeals = await appealOperations.getByBatchId(persistenceBatchId);
      assert.equal(appeals.length >= 2, true);
      
      appeals.forEach(appeal => {
        assert.equal(appeal.batchId, persistenceBatchId);
      });

      console.log('✅ 按批次查询申诉测试通过');
    });

    it('按异常查询申诉', async () => {
      const anomalyId = persistenceAnomalies[0].id;
      const appeals = await appealOperations.getByAnomalyId(anomalyId);
      
      assert.equal(appeals.length >= 1, true);
      appeals.forEach(appeal => {
        assert.equal(appeal.anomalyId, anomalyId);
      });

      console.log('✅ 按异常查询申诉测试通过');
    });

    it('查询异常的待处理申诉', async () => {
      const anomalyId = persistenceAnomalies[1].id;
      const pendingAppeal = await appealOperations.getPendingByAnomalyId(anomalyId);
      
      assert.ok(pendingAppeal);
      assert.equal(pendingAppeal.status, 'pending');
      assert.equal(pendingAppeal.anomalyId, anomalyId);

      console.log('✅ 查询待处理申诉测试通过');
    });

    it('按状态筛选申诉', async () => {
      await createAppeal({
        anomalyId: persistenceAnomalies[2].id,
        reason: '待筛选测试申诉',
        evidence: [],
      });

      const pendingAppeals = await appealOperations.getByBatchIdAndStatus(persistenceBatchId, 'pending');
      assert.equal(pendingAppeals.length >= 3, true);
      
      pendingAppeals.forEach(appeal => {
        assert.equal(appeal.status, 'pending');
      });

      console.log('✅ 按状态筛选申诉测试通过');
    });

    it('模拟重启后申诉数据仍可访问', async () => {
      const appealsBefore = await appealOperations.getByBatchId(persistenceBatchId);
      const countBefore = appealsBefore.length;
      
      useAppStore.getState().clearCurrentBatchData();
      
      const appealsAfter = await appealOperations.getByBatchId(persistenceBatchId);
      assert.equal(appealsAfter.length, countBefore, '重启后申诉数量应保持不变');
      
      await useAppStore.getState().selectBatch(persistenceBatchId);
      
      const storeAppeals = useAppStore.getState().appeals;
      assert.equal(storeAppeals.length, countBefore, 'Store 中申诉数量应与数据库一致');

      console.log('✅ 跨重启持久化测试通过');
    });
  });

  describe('4. 审批流程与自动修正测试', () => {
    let approvalBatchId: string;
    let approvalAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('审批流程测试批次', 1);
      approvalBatchId = batch.id;
      approvalAnomalies = await createTestAnomalies(approvalBatchId, 6);
      
      batch.stats = {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 6,
        pendingAnomalies: 6,
        correctedAnomalies: 0,
      };
      await batchOperations.update(batch);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(approvalBatchId);
    });

    it('通过申诉自动生成修正记录', async () => {
      const anomalyId = approvalAnomalies[0].id;
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '申诉通过测试',
        correctionType: 'mark_normal',
        correctionValue: {},
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const approveResult = await approveAppeal({
        appealId: createResult.appeal.id,
        comment: '情况属实，予以通过',
      });

      assert.equal(approveResult.success, true);
      assert.ok(approveResult.appeal);
      assert.equal(approveResult.appeal.status, 'approved');
      assert.ok(approveResult.correction);
      assert.equal(approveResult.correction.type, 'mark_normal');
      assert.equal(approveResult.correction.anomalyId, anomalyId);
      assert.ok(approveResult.correction.reason.includes('申诉通过：申诉通过测试'));
      assert.ok(approveResult.correction.reason.includes('审批意见：情况属实，予以通过'));

      const updatedAnomaly = await anomalyOperations.getById(anomalyId);
      assert.ok(updatedAnomaly);
      assert.equal(updatedAnomaly.status, 'corrected');

      const correction = await correctionOperations.getById(approveResult.correction.id);
      assert.ok(correction);
      assert.ok(correction.newValue);

      const updatedAppeal = await appealOperations.getById(createResult.appeal.id);
      assert.ok(updatedAppeal);
      assert.equal(updatedAppeal.status, 'approved');
      assert.equal(updatedAppeal.reviewComment, '情况属实，予以通过');
      assert.equal(updatedAppeal.correctionId, approveResult.correction.id);

      console.log('✅ 通过申诉并自动生成修正测试通过');
    });

    it('驳回申诉不改变原异常', async () => {
      const anomalyId = approvalAnomalies[1].id;
      const anomalyBefore = await anomalyOperations.getById(anomalyId);
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '申诉驳回测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const rejectResult = await rejectAppeal({
        appealId: createResult.appeal.id,
        comment: '证据不足，予以驳回',
      });

      assert.equal(rejectResult.success, true);
      assert.ok(rejectResult.appeal);
      assert.equal(rejectResult.appeal.status, 'rejected');
      assert.equal(rejectResult.appeal.reviewComment, '证据不足，予以驳回');

      const anomalyAfter = await anomalyOperations.getById(anomalyId);
      assert.ok(anomalyAfter);
      assert.equal(anomalyAfter.status, anomalyBefore?.status);

      const appealAfter = await appealOperations.getById(createResult.appeal.id);
      assert.ok(appealAfter);
      assert.equal(appealAfter.status, 'rejected');
      assert.equal(appealAfter.correctionId, undefined);

      console.log('✅ 驳回申诉测试通过');
    });

    it('撤销申诉不改变原异常', async () => {
      const anomalyId = approvalAnomalies[2].id;
      const anomalyBefore = await anomalyOperations.getById(anomalyId);
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '申诉撤销测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const revokeResult = await revokeAppeal(createResult.appeal.id);

      assert.equal(revokeResult.success, true);
      assert.ok(revokeResult.appeal);
      assert.equal(revokeResult.appeal.status, 'revoked');

      const anomalyAfter = await anomalyOperations.getById(anomalyId);
      assert.ok(anomalyAfter);
      assert.equal(anomalyAfter.status, anomalyBefore?.status);

      const appealAfter = await appealOperations.getById(createResult.appeal.id);
      assert.ok(appealAfter);
      assert.equal(appealAfter.status, 'revoked');

      console.log('✅ 撤销申诉测试通过');
    });

    it('通过带 adjust_time 修正类型的申诉', async () => {
      const anomalyId = approvalAnomalies[3].id;
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '时间调整申诉',
        correctionType: 'adjust_time',
        correctionValue: {
          punchIn: '08:55',
          punchOut: '18:05',
          durationMinutes: 550,
        },
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const approveResult = await approveAppeal({
        appealId: createResult.appeal.id,
        comment: '时间确认无误',
      });

      assert.equal(approveResult.success, true);
      assert.ok(approveResult.correction);
      assert.equal(approveResult.correction.type, 'adjust_time');
      const correctionValue = JSON.parse(approveResult.correction.newValue);
      assert.equal(correctionValue.punchIn, '08:55');
      assert.equal(correctionValue.punchOut, '18:05');

      console.log('✅ 通过带时间调整的申诉测试通过');
    });

    it('通过带 add_punch 修正类型的申诉', async () => {
      const anomalyId = approvalAnomalies[4].id;
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '补卡申诉',
        correctionType: 'add_punch',
        correctionValue: {
          punchTime: '2024-01-20T09:00:00',
          punchType: 'in',
        },
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const approveResult = await approveAppeal({
        appealId: createResult.appeal.id,
        comment: '补卡确认',
      });

      assert.equal(approveResult.success, true);
      assert.ok(approveResult.correction);
      assert.equal(approveResult.correction.type, 'add_punch');
      const correctionValue = JSON.parse(approveResult.correction.newValue);
      assert.equal(correctionValue.punchTime, '2024-01-20T09:00:00');
      assert.equal(correctionValue.punchType, 'in');

      console.log('✅ 通过带补卡的申诉测试通过');
    });

    it('终端状态无法再次审批', async () => {
      const anomalyId = approvalAnomalies[5].id;
      
      const createResult = await createAppeal({
        anomalyId,
        reason: '终端状态测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const rejectResult = await rejectAppeal({
        appealId: createResult.appeal.id,
        comment: '驳回',
      });
      assert.equal(rejectResult.success, true);
      
      const approveAgainResult = await approveAppeal({
        appealId: createResult.appeal.id,
        comment: '再次尝试通过',
      });
      
      assert.equal(approveAgainResult.success, false);
      assert.ok(approveAgainResult.conflicts);
      assert.equal(approveAgainResult.conflicts.length >= 1, true);
      
      const invalidTransitionConflict = approveAgainResult.conflicts.find(
        c => c.type === 'invalid_state_transition'
      );
      assert.ok(invalidTransitionConflict);

      console.log('✅ 终端状态无法再次审批测试通过');
    });
  });

  describe('5. 审计日志记录测试', () => {
    let auditBatchId: string;
    let auditAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('审计日志测试批次', 1);
      auditBatchId = batch.id;
      auditAnomalies = await createTestAnomalies(auditBatchId, 4);
      
      batch.stats = {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 4,
        pendingAnomalies: 4,
        correctedAnomalies: 0,
      };
      await batchOperations.update(batch);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(auditBatchId);
    });

    it('创建申诉记录审计日志', async () => {
      const state = useAppStore.getState();
      const logsBefore = state.auditLogs.length;
      
      const result = await state.createAppeal({
        anomalyId: auditAnomalies[0].id,
        reason: '审计测试申诉',
        evidence: [],
      });
      
      assert.equal(result.success, true);
      
      const logsAfter = state.auditLogs.length;
      assert.equal(logsAfter, logsBefore + 1);
      
      const latestLog = state.auditLogs[state.auditLogs.length - 1];
      assert.equal(latestLog.action, 'appeal_create');
      assert.equal(latestLog.success, true);
      assert.ok(latestLog.statsBefore);
      assert.ok(latestLog.statsAfter);
      assert.equal(latestLog.linkedEntityIds.anomalyIds?.includes(auditAnomalies[0].id), true);
      assert.ok(latestLog.metadata.appealId);

      console.log('✅ 创建申诉审计日志测试通过');
    });

    it('通过申诉记录审计日志（含自动修正）', async () => {
      const state = useAppStore.getState();
      const logsBefore = state.auditLogs.length;
      
      const createResult = await state.createAppeal({
        anomalyId: auditAnomalies[1].id,
        reason: '审批审计测试',
        correctionType: 'mark_normal',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const approveResult = await state.approveAppeal({
        appealId: createResult.appeal.id,
        comment: '通过',
      });
      
      assert.equal(approveResult.success, true);
      
      const logsAfter = state.auditLogs.length;
      assert.equal(logsAfter, logsBefore + 2);
      
      const appealApproveLog = state.auditLogs[state.auditLogs.length - 2];
      assert.equal(appealApproveLog.action, 'appeal_approve');
      
      const autoCorrectLog = state.auditLogs[state.auditLogs.length - 1];
      assert.equal(autoCorrectLog.action, 'appeal_auto_correct');
      assert.ok(autoCorrectLog.linkedEntityIds.correctionIds);

      console.log('✅ 通过申诉审计日志测试通过');
    });

    it('驳回申诉记录审计日志', async () => {
      const state = useAppStore.getState();
      const logsBefore = state.auditLogs.length;
      
      const createResult = await state.createAppeal({
        anomalyId: auditAnomalies[2].id,
        reason: '驳回审计测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const rejectResult = await state.rejectAppeal({
        appealId: createResult.appeal.id,
        comment: '驳回',
      });
      
      assert.equal(rejectResult.success, true);
      
      const logsAfter = state.auditLogs.length;
      assert.equal(logsAfter, logsBefore + 2);
      
      const latestLog = state.auditLogs[state.auditLogs.length - 1];
      assert.equal(latestLog.action, 'appeal_reject');
      assert.equal(latestLog.description.includes('驳回'), true);

      console.log('✅ 驳回申诉审计日志测试通过');
    });

    it('撤销申诉记录审计日志', async () => {
      const state = useAppStore.getState();
      const logsBefore = state.auditLogs.length;
      
      const createResult = await state.createAppeal({
        anomalyId: auditAnomalies[3].id,
        reason: '撤销审计测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const revokeResult = await state.revokeAppeal(createResult.appeal.id);
      
      assert.equal(revokeResult.success, true);
      
      const logsAfter = state.auditLogs.length;
      assert.equal(logsAfter, logsBefore + 2);
      
      const latestLog = state.auditLogs[state.auditLogs.length - 1];
      assert.equal(latestLog.action, 'appeal_revoke');
      assert.equal(latestLog.description.includes('撤销'), true);

      console.log('✅ 撤销申诉审计日志测试通过');
    });
  });

  describe('6. CSV 导出测试', () => {
    let exportBatchId: string;
    let exportAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('导出测试批次', 1);
      exportBatchId = batch.id;
      exportAnomalies = await createTestAnomalies(exportBatchId, 4);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(exportBatchId);
    });

    it('生成 CSV 内容格式正确', async () => {
      const createResult1 = await createAppeal({
        anomalyId: exportAnomalies[0].id,
        reason: '导出测试申诉1',
        evidence: [],
      });
      
      const createResult2 = await createAppeal({
        anomalyId: exportAnomalies[1].id,
        reason: '导出测试申诉2',
        evidence: [],
      });
      
      assert.ok(createResult1.success && createResult1.appeal);
      assert.ok(createResult2.success && createResult2.appeal);
      
      await approveAppeal({
        appealId: createResult1.appeal.id,
        comment: '通过',
      });
      
      await rejectAppeal({
        appealId: createResult2.appeal.id,
        comment: '驳回',
      });
      
      const appeals = await appealOperations.getByBatchId(exportBatchId);
      const csv = generateAppealCSV(appeals);
      
      assert.ok(csv);
      assert.equal(csv.length > 0, true);
      
      const lines = csv.trim().split('\n');
      assert.equal(lines.length >= 3, true);
      
      const header = lines[0];
      assert.equal(header.includes('申诉编号'), true);
      assert.equal(header.includes('员工姓名'), true);
      assert.equal(header.includes('员工编号'), true);
      assert.equal(header.includes('部门'), true);
      assert.equal(header.includes('异常日期'), true);
      assert.equal(header.includes('异常类型'), true);
      assert.equal(header.includes('申诉原因'), true);
      assert.equal(header.includes('状态'), true);
      assert.equal(header.includes('申诉日期'), true);
      assert.equal(header.includes('审批意见'), true);
      
      const dataLines = lines.slice(1);
      dataLines.forEach(line => {
        const cells = line.split(',');
        assert.equal(cells.length >= 9, true);
      });

      console.log('✅ CSV 导出格式测试通过');
    });

    it('空数据生成安全 CSV', () => {
      const emptyCSV = generateAppealCSV([]);
      assert.equal(emptyCSV, '');
      console.log('✅ 空数据 CSV 导出测试通过');
    });

    it('CSV 内容包含正确的状态标签', async () => {
      const appeals = await appealOperations.getByBatchId(exportBatchId);
      const csv = generateAppealCSV(appeals);
      
      assert.equal(csv.includes('待处理'), true);
      assert.equal(csv.includes('已通过'), true);
      assert.equal(csv.includes('已驳回'), true);
      assert.equal(csv.includes('申诉通过'), true);

      console.log('✅ CSV 状态标签测试通过');
    });

    it('特殊字符正确转义', async () => {
      const createResult = await createAppeal({
        anomalyId: exportAnomalies[2].id,
        reason: '包含,逗号和"引号的申诉原因',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const appeals = await appealOperations.getByBatchId(exportBatchId);
      const csv = generateAppealCSV(appeals);
      
      assert.equal(csv.includes('"包含,逗号和""引号的申诉原因"'), true);

      console.log('✅ CSV 特殊字符转义测试通过');
    });
  });

  describe('7. 批次级联删除测试', () => {
    let cascadeBatchId: string;
    let cascadeAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('级联删除测试批次', 1);
      cascadeBatchId = batch.id;
      cascadeAnomalies = await createTestAnomalies(cascadeBatchId, 3);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(cascadeBatchId);
    });

    it('删除批次时级联删除关联申诉', async () => {
      for (let i = 0; i < 3; i++) {
        await createAppeal({
          anomalyId: cascadeAnomalies[i].id,
          reason: `级联删除测试申诉${i + 1}`,
          evidence: [],
        });
      }
      
      const appealsBefore = await appealOperations.getByBatchId(cascadeBatchId);
      assert.equal(appealsBefore.length, 3);
      
      await batchOperations.delete(cascadeBatchId);
      
      const appealsAfter = await appealOperations.getByBatchId(cascadeBatchId);
      assert.equal(appealsAfter.length, 0);

      console.log('✅ 批次级联删除申诉测试通过');
    });
  });

  describe('8. Store 集成测试', () => {
    let storeBatchId: string;
    let storeAnomalies: Anomaly[] = [];

    before(async () => {
      const batch = await createTestBatch('Store集成测试批次', 1);
      storeBatchId = batch.id;
      storeAnomalies = await createTestAnomalies(storeBatchId, 3);
      
      batch.stats = {
        totalSchedules: 0,
        totalPunches: 0,
        totalLeaves: 0,
        totalAnomalies: 3,
        pendingAnomalies: 3,
        correctedAnomalies: 0,
      };
      await batchOperations.update(batch);
      
      await useAppStore.getState().loadBatches();
      await useAppStore.getState().selectBatch(storeBatchId);
    });

    it('Store 申诉列表加载正确', async () => {
      const state = useAppStore.getState();
      
      await state.createAppeal({
        anomalyId: storeAnomalies[0].id,
        reason: 'Store集成测试申诉',
        evidence: [],
      });
      
      await state.loadAppeals(storeBatchId);
      
      assert.equal(state.appeals.length >= 1, true);
      
      const appeal = state.appeals.find(a => a.anomalyId === storeAnomalies[0].id);
      assert.ok(appeal);
      assert.equal(appeal.reason, 'Store集成测试申诉');

      console.log('✅ Store 申诉列表加载测试通过');
    });

    it('Store 申诉筛选功能正常', async () => {
      const state = useAppStore.getState();
      
      const createResult = await state.createAppeal({
        anomalyId: storeAnomalies[1].id,
        reason: '筛选测试申诉',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      await state.approveAppeal({
        appealId: createResult.appeal.id,
        comment: '通过',
      });
      
      await state.loadAppeals(storeBatchId, 'approved');
      
      assert.equal(state.appeals.every(a => a.status === 'approved'), true);
      
      await state.loadAppeals(storeBatchId, 'pending');
      
      assert.equal(state.appeals.every(a => a.status === 'pending'), true);

      console.log('✅ Store 申诉筛选测试通过');
    });

    it('Store 冲突检测包装正常', async () => {
      const state = useAppStore.getState();
      
      const createResult = await state.createAppeal({
        anomalyId: storeAnomalies[2].id,
        reason: '冲突检测包装测试',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const conflicts = await state.checkAppealConflicts(storeAnomalies[2].id);
      
      assert.equal(conflicts.length >= 1, true);
      assert.equal(conflicts[0].type, 'pending_appeal_exists');

      console.log('✅ Store 冲突检测包装测试通过');
    });

    it('统计信息更新正确', async () => {
      const state = useAppStore.getState();
      await state.selectBatch(storeBatchId);
      
      const statsBefore = state.getCurrentStatsSnapshot();
      const pendingBefore = statsBefore.pendingAnomalies;
      const correctedBefore = statsBefore.correctedAnomalies;
      
      const createResult = await state.createAppeal({
        anomalyId: storeAnomalies[0].id,
        reason: '统计更新测试',
        correctionType: 'mark_normal',
        evidence: [],
      });
      
      assert.ok(createResult.success && createResult.appeal);
      
      const approveResult = await state.approveAppeal({
        appealId: createResult.appeal.id,
        comment: '通过',
      });
      
      assert.equal(approveResult.success, true);
      
      const statsAfter = state.getCurrentStatsSnapshot();
      assert.equal(statsAfter.pendingAnomalies, pendingBefore - 1);
      assert.equal(statsAfter.correctedAnomalies, correctedBefore + 1);

      console.log('✅ 统计信息更新测试通过');
    });
  });
});
