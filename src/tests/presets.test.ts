import 'fake-indexeddb/auto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, clearDB, presetOperations } from '../db';
import { useAppStore } from '../store';
import { generateId } from '../utils/dateUtils';
import type {
  Preset,
  ImportPresetConfig,
  ExportPresetConfig,
  PresetConflict,
  AuditActionType,
} from '../types';
import {
  createPreset,
  checkConflicts,
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
import { getBatchAuditTimeline } from '../modules/audit';

describe('预设功能测试', () => {
  const testImportConfig: ImportPresetConfig = {
    fieldMapping: {
      schedule: { employeeId: '工号', employeeName: '姓名', scheduleDate: '日期' },
      punch: { employeeId: '工号', punchTime: '打卡时间' },
      leave: { employeeId: '工号', leaveDate: '日期', leaveType: '类型' },
    },
    timezone: 'Asia/Shanghai',
    duplicatePunchWindowMinutes: 5,
  };

  const testExportConfig: ExportPresetConfig = {
    format: 'html',
    title: '考勤异常分析报告',
    includeCharts: true,
    includeAuditSummary: true,
    includeCorrections: true,
  };

  before(async () => {
    await initDB();
    await clearDB();
    await presetOperations.clear();
    useAppStore.getState().clearCurrentBatchData();
  });

  after(async () => {
    await clearDB();
    await presetOperations.clear();
    useAppStore.getState().clearCurrentBatchData();
  });

  describe('1. 预设创建和 CRUD 操作', () => {
    it('创建导入预设成功', async () => {
      const preset = await createPreset<ImportPresetConfig>({
        name: '标准导入配置',
        description: '用于日常考勤数据导入',
        type: 'import',
        config: testImportConfig,
        operator: 'test_user',
      });

      assert.ok(preset.id);
      assert.equal(preset.name, '标准导入配置');
      assert.equal(preset.type, 'import');
      assert.equal(preset.version, 1);
      assert.equal(preset.schemaVersion, 1);
      assert.equal(preset.config.timezone, 'Asia/Shanghai');
      assert.equal(preset.config.duplicatePunchWindowMinutes, 5);
      assert.equal(preset.createdBy, 'test_user');
      assert.ok(preset.createdAt instanceof Date);
      assert.ok(preset.updatedAt instanceof Date);

      console.log('✅ 创建导入预设成功');
    });

    it('创建导出预设成功', async () => {
      const preset = await createPreset<ExportPresetConfig>({
        name: '标准导出配置',
        description: '用于生成正式报告',
        type: 'export',
        config: testExportConfig,
        operator: 'test_user',
      });

      assert.ok(preset.id);
      assert.equal(preset.name, '标准导出配置');
      assert.equal(preset.type, 'export');
      assert.equal(preset.config.format, 'html');
      assert.equal(preset.config.title, '考勤异常分析报告');
      assert.equal(preset.config.includeCharts, true);
      assert.equal(preset.config.includeAuditSummary, true);

      console.log('✅ 创建导出预设成功');
    });

    it('获取所有预设', async () => {
      const presets = await getPresets();
      assert.equal(presets.length, 2);

      const importPresets = await getPresets('import');
      assert.equal(importPresets.length, 1);
      assert.equal(importPresets[0].type, 'import');

      const exportPresets = await getPresets('export');
      assert.equal(exportPresets.length, 1);
      assert.equal(exportPresets[0].type, 'export');

      console.log('✅ 获取预设列表成功');
    });

    it('根据 ID 获取预设', async () => {
      const allPresets = await getPresets();
      const firstPreset = allPresets[0];

      const found = await getPresetById(firstPreset.id);
      assert.ok(found);
      assert.equal(found.id, firstPreset.id);
      assert.equal(found.name, firstPreset.name);

      console.log('✅ 根据ID获取预设成功');
    });

    it('更新预设配置和名称', async () => {
      const importPresets = await getPresets('import');
      const preset = importPresets[0];

      const updated = await updatePreset<ImportPresetConfig>({
        id: preset.id,
        name: '更新后的导入配置',
        description: '更新后的描述',
        config: {
          ...testImportConfig,
          duplicatePunchWindowMinutes: 10,
        },
        operator: 'test_user',
      });

      assert.ok(updated);
      assert.equal(updated.name, '更新后的导入配置');
      assert.equal(updated.description, '更新后的描述');
      assert.equal(updated.config.duplicatePunchWindowMinutes, 10);
      assert.equal(updated.version, 2);

      console.log('✅ 更新预设成功');
    });

    it('复制预设', async () => {
      const exportPresets = await getPresets('export');
      const original = exportPresets[0];

      const duplicated = await duplicatePreset(original.id, '复制的导出配置', 'test_user');
      assert.ok(duplicated);
      assert.notEqual(duplicated.id, original.id);
      assert.equal(duplicated.name, '复制的导出配置');
      assert.equal(duplicated.version, 1);
      assert.equal((duplicated.config as ExportPresetConfig).format, (original.config as ExportPresetConfig).format);
      assert.equal(duplicated.metadata.duplicatedFrom, original.id);

      const allPresets = await getPresets();
      assert.equal(allPresets.length, 3);

      console.log('✅ 复制预设成功');
    });

    it('删除预设', async () => {
      const presets = await getPresets();
      const presetToDelete = presets.find(p => p.name === '复制的导出配置');
      assert.ok(presetToDelete);

      const result = await deletePreset(presetToDelete.id);
      assert.equal(result, true);

      const afterDelete = await getPresets();
      assert.equal(afterDelete.length, 2);

      const notFound = await getPresetById(presetToDelete.id);
      assert.equal(notFound, undefined);

      console.log('✅ 删除预设成功');
    });
  });

  describe('2. 冲突检测和处理', () => {
    it('检测同名预设冲突', async () => {
      const conflicts = await checkConflicts({
        name: '标准导出配置',
        type: 'export',
      });

      const nameConflict = conflicts.find(c => c.type === 'name_exists');
      assert.ok(nameConflict);
      assert.equal(nameConflict.message.includes('标准导出配置'), true);

      console.log('✅ 同名预设冲突检测成功');
    });

    it('检测缺少字段冲突', async () => {
      const invalidConfig = {
        fieldMapping: { schedule: {}, punch: {}, leave: {} },
        timezone: '',
      } as ImportPresetConfig;

      const conflicts = await checkConflicts({
        name: '测试预设',
        type: 'import',
        config: invalidConfig,
      });

      const missingFieldsConflict = conflicts.find(c => c.type === 'missing_fields');
      assert.ok(missingFieldsConflict);
      assert.equal(missingFieldsConflict.details.missingFields.includes('timezone'), true);
      assert.equal(missingFieldsConflict.details.missingFields.includes('duplicatePunchWindowMinutes'), true);

      console.log('✅ 缺少字段冲突检测成功');
    });

    it('检测 schema 版本不兼容', async () => {
      const conflicts = await checkConflicts({
        schemaVersion: 999,
      });

      const versionConflict = conflicts.find(c => c.type === 'version_incompatible');
      assert.ok(versionConflict);
      assert.equal(versionConflict.message.includes('版本不兼容'), true);

      console.log('✅ 版本不兼容检测成功');
    });

    it('savePreset 遇到同名冲突时要求确认', async () => {
      const result = await savePreset<ExportPresetConfig>({
        name: '标准导出配置',
        type: 'export',
        config: testExportConfig,
      }, false);

      assert.equal(result.success, false);
      assert.equal(result.requiresConfirmation, true);
      assert.ok(result.conflicts);
      assert.ok(result.conflicts.some(c => c.type === 'name_exists'));

      console.log('✅ 同名预设保存时要求确认成功');
    });

    it('savePreset 覆盖同名预设成功', async () => {
      const newConfig: ExportPresetConfig = {
        ...testExportConfig,
        format: 'markdown',
        title: '更新后的标题',
      };

      const result = await savePreset<ExportPresetConfig>({
        name: '标准导出配置',
        type: 'export',
        config: newConfig,
        operator: 'test_user',
      }, true);

      assert.equal(result.success, true);
      assert.equal(result.requiresConfirmation, false);
      assert.ok(result.preset);
      assert.equal(result.preset.version, 2);
      assert.equal((result.preset!.config as ExportPresetConfig).format, 'markdown');
      assert.equal((result.preset!.config as ExportPresetConfig).title, '更新后的标题');

      console.log('✅ 覆盖同名预设成功');
    });

    it('重命名预设时检测同名冲突', async () => {
      const importPresets = await getPresets('import');
      const preset = importPresets[0];

      await assert.rejects(
        async () => {
          await updatePreset({
            id: preset.id,
            name: '标准导出配置',
          });
        },
        (err: Error) => {
          assert.equal(err.message.includes('已存在同名'), true);
          return true;
        }
      );

      console.log('✅ 重命名时同名冲突检测成功');
    });

    it('复制预设时检测同名冲突', async () => {
      const exportPresets = await getPresets('export');
      const preset = exportPresets[0];

      await assert.rejects(
        async () => {
          await duplicatePreset(preset.id, '标准导出配置');
        },
        (err: Error) => {
          assert.equal(err.message.includes('已存在同名'), true);
          return true;
        }
      );

      console.log('✅ 复制时同名冲突检测成功');
    });
  });

  describe('3. 预设套用验证', () => {
    it('套用有效预设成功', async () => {
      const importPresets = await getPresets('import');
      const preset = importPresets[0];

      const result = await applyPreset(preset.id);
      assert.equal(result.success, true);
      assert.equal(result.requiresConfirmation, false);
      assert.ok(result.preset);
      assert.equal(result.preset.id, preset.id);

      console.log('✅ 套用有效预设成功');
    });

    it('套用不存在的预设失败', async () => {
      const result = await applyPreset('non-existent-id');
      assert.equal(result.success, false);
      assert.equal(result.requiresConfirmation, false);
      assert.ok(result.conflicts);
      assert.equal(result.conflicts[0].message, '预设不存在');

      console.log('✅ 套用不存在的预设失败处理成功');
    });

    it('generatePresetSummary 生成导入预设摘要', async () => {
      const importPresets = await getPresets('import');
      const preset = importPresets[0];

      const summary = generatePresetSummary(preset);
      assert.equal(summary.type, 'import');
      assert.equal(summary.name, preset.name);
      assert.equal(summary.timezone, (preset.config as ImportPresetConfig).timezone);
      assert.equal(summary.duplicateWindow, (preset.config as ImportPresetConfig).duplicatePunchWindowMinutes);
      assert.ok(summary.fieldMappingCount);
      assert.equal(summary.fieldMappingCount.schedule, 3);
      assert.equal(summary.fieldMappingCount.punch, 2);
      assert.equal(summary.fieldMappingCount.leave, 3);

      console.log('✅ 导入预设摘要生成成功');
    });

    it('generatePresetSummary 生成导出预设摘要', async () => {
      const exportPresets = await getPresets('export');
      const preset = exportPresets[0];

      const summary = generatePresetSummary(preset);
      assert.equal(summary.type, 'export');
      assert.equal(summary.name, preset.name);
      assert.equal(summary.format, (preset.config as ExportPresetConfig).format);
      assert.equal(summary.title, (preset.config as ExportPresetConfig).title);
      assert.equal(summary.includeCharts, (preset.config as ExportPresetConfig).includeCharts);
      assert.equal(summary.includeAuditSummary, (preset.config as ExportPresetConfig).includeAuditSummary);

      console.log('✅ 导出预设摘要生成成功');
    });
  });

  describe('4. JSON 导入导出功能', () => {
    it('导出所有预设为 JSON', async () => {
      const result = await exportPresetsToJSON();

      assert.equal(result.version, 1);
      assert.equal(result.schemaVersion, 1);
      assert.ok(result.exportedAt);
      assert.equal(result.presets.length, 2);

      const presetNames = result.presets.map(p => p.name).sort();
      assert.deepEqual(presetNames, ['更新后的导入配置', '标准导出配置']);

      console.log('✅ 导出所有预设为JSON成功');
    });

    it('导出指定预设为 JSON', async () => {
      const allPresets = await getPresets();
      const idsToExport = [allPresets[0].id];

      const result = await exportPresetsToJSON(idsToExport);
      assert.equal(result.presets.length, 1);
      assert.equal(result.presets[0].id, allPresets[0].id);

      console.log('✅ 导出指定预设为JSON成功');
    });

    it('导入 JSON 预设 - 无冲突情况', async () => {
      const exportResult = await exportPresetsToJSON();
      assert.equal(exportResult.presets.length, 2, '导出前应有2个预设');

      const originalPresets = [...exportResult.presets];

      const jsonToImport = {
        ...exportResult,
        presets: exportResult.presets.map(p => ({
          ...p,
          name: `导入的${p.name}`,
        })),
      };

      const result = await importPresetsFromJSON(jsonToImport, 'importer_user');

      assert.equal(result.imported.length, 2);
      assert.equal(result.skipped.length, 0);
      assert.equal(result.conflicts.length, 0);

      result.imported.forEach(preset => {
        assert.equal(preset.name.startsWith('导入的'), true);
        assert.equal(preset.createdBy, 'importer_user');
        assert.equal(preset.metadata.importedFrom, exportResult.presets.find(
          ep => `导入的${ep.name}` === preset.name
        )?.id);
      });

      const presetsAfter = await getPresets();
      assert.equal(presetsAfter.length, 4);

      for (const imported of result.imported) {
        await deletePreset(imported.id);
      }

      const presetsAfterCleanup = await getPresets();
      assert.equal(presetsAfterCleanup.length, 2);

      console.log('✅ 导入JSON预设（无冲突）成功');
    });

    it('导入 JSON 预设 - 同名冲突情况', async () => {
      const existingPresets = await getPresets();
      assert.equal(existingPresets.length, 2, '应有2个现有预设');
      const existingName = existingPresets[0].name;

      const jsonWithConflict = {
        version: 1,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        presets: [{
          ...existingPresets[0],
          id: generateId(),
          name: existingName,
        }],
      };

      const result = await importPresetsFromJSON(jsonWithConflict);

      assert.equal(result.imported.length, 0);
      assert.equal(result.conflicts.length, 1);
      assert.equal(result.conflicts[0].conflicts.some(c => c.type === 'name_exists'), true);

      console.log('✅ 导入JSON预设（同名冲突）检测成功');
    });

    it('强制导入预设 - 覆盖模式', async () => {
      const existingPresets = await getPresets();
      assert.equal(existingPresets.length, 2, '应有2个现有预设');
      const existing = existingPresets[0];
      const originalVersion = existing.version;
      const originalTimezone = (existing.config as ImportPresetConfig).timezone;

      const presetToImport: Preset = {
        ...existing,
        id: generateId(),
        name: existing.name,
        config: {
          ...existing.config,
          timezone: 'America/New_York',
        } as ImportPresetConfig,
      };

      const result = await forceImportPreset(presetToImport, true, 'importer_user');

      assert.ok(result);
      assert.equal(result.id, existing.id);
      assert.equal((result.config as ImportPresetConfig).timezone, 'America/New_York');
      assert.equal(result.version, originalVersion + 1);
      assert.equal(result.metadata.importedFrom, presetToImport.id);

      const restored = await updatePreset({
        id: existing.id,
        config: {
          ...existing.config,
          timezone: originalTimezone,
        } as ImportPresetConfig,
      });
      assert.ok(restored);
      assert.equal((restored.config as ImportPresetConfig).timezone, originalTimezone);

      console.log('✅ 强制导入（覆盖模式）成功');
    });

    it('强制导入预设 - 自动重命名模式', async () => {
      const existingPresets = await getPresets();
      assert.equal(existingPresets.length, 2, '应有2个现有预设');
      const existing = existingPresets[0];

      const presetToImport: Preset = {
        ...existing,
        id: generateId(),
        name: existing.name,
        config: {
          ...existing.config,
          timezone: 'Europe/London',
        } as ImportPresetConfig,
      };

      const result = await forceImportPreset(presetToImport, false, 'importer_user');

      assert.ok(result);
      assert.notEqual(result.id, existing.id);
      assert.equal(result.name, `${existing.name} (1)`);
      assert.equal((result.config as ImportPresetConfig).timezone, 'Europe/London');
      assert.equal(result.metadata.originalName, existing.name);

      await deletePreset(result.id);

      console.log('✅ 强制导入（自动重命名模式）成功');
    });

    it('导入版本不兼容的 JSON 失败', async () => {
      const badJson = {
        version: 1,
        schemaVersion: 999,
        exportedAt: new Date().toISOString(),
        presets: [],
      };

      await assert.rejects(
        () => importPresetsFromJSON(badJson),
        (err: Error) => err.message.includes('不支持的预设 schema 版本')
      );

      console.log('✅ 导入版本不兼容JSON失败处理成功');
    });
  });

  describe('5. 跨重启数据持久化', () => {
    it('预设数据持久化到 IndexedDB', async () => {
      await presetOperations.clear();

      const preset1 = await createPreset<ImportPresetConfig>({
        name: '持久化测试-导入',
        type: 'import',
        config: testImportConfig,
        operator: 'persist_user',
      });

      const preset2 = await createPreset<ExportPresetConfig>({
        name: '持久化测试-导出',
        type: 'export',
        config: testExportConfig,
        operator: 'persist_user',
      });

      const presets = await presetOperations.getAll();
      assert.equal(presets.length, 2);

      const byId1 = await presetOperations.getById(preset1.id);
      assert.ok(byId1);
      assert.equal(byId1.name, '持久化测试-导入');

      const byId2 = await presetOperations.getById(preset2.id);
      assert.ok(byId2);
      assert.equal(byId2.name, '持久化测试-导出');

      console.log('✅ 预设数据持久化到IndexedDB成功');
    });

    it('模拟重启后预设数据仍可访问', async () => {
      const beforePresets = await presetOperations.getAll();
      assert.equal(beforePresets.length, 2);

      const storedIds = beforePresets.map(p => p.id);

      useAppStore.getState().presets = [];
      useAppStore.setState({ presets: [] });

      await useAppStore.getState().loadPresets();

      const afterPresets = useAppStore.getState().presets;
      assert.equal(afterPresets.length, 2);

      const afterIds = afterPresets.map(p => p.id);
      storedIds.forEach(id => {
        assert.equal(afterIds.includes(id), true, `预设ID ${id} 应该在重启后仍存在`);
      });

      console.log('✅ 模拟重启后预设数据持久化验证成功');
    });

    it('store.loadPresets 按类型筛选', async () => {
      await useAppStore.getState().loadPresets('import');
      const importPresets = useAppStore.getState().presets;
      assert.equal(importPresets.length, 1);
      assert.equal(importPresets[0].type, 'import');

      await useAppStore.getState().loadPresets('export');
      const exportPresets = useAppStore.getState().presets;
      assert.equal(exportPresets.length, 1);
      assert.equal(exportPresets[0].type, 'export');

      console.log('✅ store.loadPresets 按类型筛选成功');
    });
  });

  describe('6. 审计日志记录', () => {
    let testBatchId: string;

    before(async () => {
      await presetOperations.clear();
      
      const state = useAppStore.getState();
      const batch = await state.createBatch('预设审计测试批次');
      testBatchId = batch.id;
      await state.selectBatch(testBatchId);
    });

    it('保存导入预设记录审计日志', async () => {
      const result = await useAppStore.getState().saveImportPreset({
        name: '审计测试导入预设',
        config: testImportConfig,
        operator: 'audit_user',
      });

      assert.equal(result.success, true);
      assert.ok(result.preset);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const saveLog = timeline.find(l => l.action === 'preset_save');

      assert.ok(saveLog);
      assert.equal(saveLog.success, true);
      assert.equal(saveLog.operator, 'audit_user');
      assert.equal(saveLog.description.includes('审计测试导入预设'), true);
      assert.equal(saveLog.metadata.presetType, 'import');
      assert.ok(saveLog.metadata.newConfig);
      assert.equal(saveLog.metadata.newConfig.name, '审计测试导入预设');

      console.log('✅ 保存预设审计日志记录成功');
    });

    it('覆盖预设记录审计日志', async () => {
      const result = await useAppStore.getState().saveImportPreset({
        name: '审计测试导入预设',
        config: { ...testImportConfig, timezone: 'Asia/Tokyo' },
        overwrite: true,
        operator: 'audit_user',
      });

      assert.equal(result.success, true);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const overwriteLog = timeline.find(l => l.action === 'preset_overwrite');

      assert.ok(overwriteLog);
      assert.equal(overwriteLog.description.includes('覆盖'), true);
      assert.equal(overwriteLog.metadata.newConfig.timezone, 'Asia/Tokyo');

      console.log('✅ 覆盖预设审计日志记录成功');
    });

    it('套用预设记录审计日志', async () => {
      const presets = await getPresets('import');
      const preset = presets[0];

      const result = await useAppStore.getState().applyPreset(preset.id, false, 'audit_user');

      assert.equal(result.success, true);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const applyLog = timeline.find(l => l.action === 'preset_apply');

      assert.ok(applyLog);
      assert.equal(applyLog.description.includes('套用'), true);
      assert.equal(applyLog.operator, 'audit_user');

      console.log('✅ 套用预设审计日志记录成功');
    });

    it('重命名预设记录审计日志', async () => {
      const presets = await getPresets('import');
      const preset = presets[0];
      const oldName = preset.name;
      const newName = '重命名后的预设';

      const result = await useAppStore.getState().renamePreset(preset.id, newName, 'audit_user');

      assert.ok(result);
      assert.equal(result.name, newName);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const renameLog = timeline.find(l => l.action === 'preset_rename');

      assert.ok(renameLog);
      assert.equal(renameLog.description.includes('重命名'), true);
      assert.equal(renameLog.metadata.oldConfig.name, oldName);
      assert.equal(renameLog.metadata.newConfig.name, newName);

      console.log('✅ 重命名预设审计日志记录成功');
    });

    it('复制预设记录审计日志', async () => {
      const presets = await getPresets('import');
      const preset = presets[0];

      const result = await useAppStore.getState().duplicatePreset(preset.id, '复制的预设', 'audit_user');

      assert.ok(result);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const duplicateLog = timeline.find(l => l.action === 'preset_duplicate');

      assert.ok(duplicateLog);
      assert.equal(duplicateLog.description.includes('复制'), true);
      assert.equal(duplicateLog.metadata.oldName, preset.name);
      assert.equal(duplicateLog.metadata.newName, '复制的预设');

      console.log('✅ 复制预设审计日志记录成功');
    });

    it('删除预设记录审计日志', async () => {
      const presets = await getPresets('import');
      const presetToDelete = presets.find(p => p.name === '复制的预设');
      assert.ok(presetToDelete);

      const result = await useAppStore.getState().deletePreset(presetToDelete.id, 'audit_user');

      assert.equal(result, true);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const deleteLog = timeline.find(l => l.action === 'preset_delete');

      assert.ok(deleteLog);
      assert.equal(deleteLog.description.includes('删除'), true);
      assert.equal(deleteLog.metadata.deletedConfig.name, '复制的预设');

      console.log('✅ 删除预设审计日志记录成功');
    });

    it('导出预设记录审计日志', async () => {
      const presets = await getPresets();
      const ids = presets.map(p => p.id);

      const result = await useAppStore.getState().exportPresetsToJSON(ids);

      assert.equal(result.presets.length, presets.length);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const exportLog = timeline.find(l => l.action === 'preset_export');

      assert.ok(exportLog);
      assert.equal(exportLog.description.includes('导出'), true);
      assert.equal(exportLog.metadata.exportCount, presets.length);

      console.log('✅ 导出预设审计日志记录成功');
    });

    it('导入预设记录审计日志', async () => {
      const exportResult = await exportPresetsToJSON();
      assert.equal(exportResult.presets.length, 1, '此时应有1个预设');
      
      const jsonToImport = {
        ...exportResult,
        presets: exportResult.presets.map(p => ({
          ...p,
          id: generateId(),
          name: `新导入${p.name}`,
        })),
      };

      const result = await useAppStore.getState().importPresetsFromJSON(jsonToImport, 'import_user');

      assert.equal(result.imported.length, 1);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const importLogs = timeline.filter(l => l.action === 'preset_import');

      assert.equal(importLogs.length, 1);
      importLogs.forEach(log => {
        assert.equal(log.operator, 'import_user');
        assert.equal(log.description.includes('导入'), true);
      });

      console.log('✅ 导入预设审计日志记录成功');
    });

    it('审计日志包含预设前后配置摘要', async () => {
      const result = await useAppStore.getState().saveExportPreset({
        name: '审计摘要测试',
        config: {
          format: 'html',
          title: '测试报告',
          includeCharts: true,
          includeAuditSummary: false,
        },
        operator: 'summary_test',
      });

      assert.equal(result.success, true);
      assert.ok(result.preset);

      const timeline = await getBatchAuditTimeline(testBatchId);
      const saveLog = timeline.find(
        l => l.action === 'preset_save' && l.metadata.newConfig?.name === '审计摘要测试'
      );

      assert.ok(saveLog);
      assert.equal(saveLog.metadata.newConfig.type, 'export');
      assert.equal(saveLog.metadata.newConfig.format, 'html');
      assert.equal(saveLog.metadata.newConfig.title, '测试报告');
      assert.equal(saveLog.metadata.newConfig.includeCharts, true);
      assert.equal(saveLog.metadata.newConfig.includeAuditSummary, false);

      console.log('✅ 审计日志包含预设配置摘要成功');
    });

    it('完整预设操作时间线验证', async () => {
      const timeline = await getBatchAuditTimeline(testBatchId);
      const actions = timeline.map(l => l.action);

      const expectedActions = [
        'batch_create',
        'preset_save',
        'preset_overwrite',
        'preset_apply',
        'preset_rename',
        'preset_duplicate',
        'preset_delete',
        'preset_export',
        'preset_import',
        'preset_save',
      ];

      expectedActions.forEach(action => {
        assert.equal(
          actions.includes(action as AuditActionType),
          true,
          `时间线应该包含 ${action} 操作`
        );
      });

      const presetActions = timeline.filter(l => l.action.startsWith('preset_'));
      assert.equal(presetActions.length >= 9, true);

      presetActions.forEach(log => {
        assert.ok(log.timestamp instanceof Date);
        assert.ok(log.operator);
        assert.ok(log.metadata.presetId);
        assert.ok(log.metadata.presetType);
      });

      console.log(`✅ 完整预设操作时间线验证通过，共 ${timeline.length} 条记录`);
    });
  });

  describe('7. Store 集成测试', () => {
    before(async () => {
      await presetOperations.clear();
      useAppStore.getState().presets = [];
    });

    it('store.saveImportPreset 集成流程', async () => {
      const result = await useAppStore.getState().saveImportPreset({
        name: 'Store集成测试导入',
        config: testImportConfig,
        operator: 'store_test',
      });

      assert.equal(result.success, true);
      assert.ok(result.preset);

      const presets = useAppStore.getState().presets;
      assert.equal(presets.length, 1);
      assert.equal(presets[0].name, 'Store集成测试导入');

      console.log('✅ store.saveImportPreset 集成测试通过');
    });

    it('store.saveExportPreset 集成流程', async () => {
      const result = await useAppStore.getState().saveExportPreset({
        name: 'Store集成测试导出',
        config: testExportConfig,
        operator: 'store_test',
      });

      assert.equal(result.success, true);
      assert.ok(result.preset);

      const presets = useAppStore.getState().presets;
      assert.equal(presets.length, 2);

      console.log('✅ store.saveExportPreset 集成测试通过');
    });

    it('store.deletePreset 集成流程', async () => {
      const presets = useAppStore.getState().presets;
      const toDelete = presets.find(p => p.name === 'Store集成测试导入');
      assert.ok(toDelete);

      const result = await useAppStore.getState().deletePreset(toDelete.id, 'store_test');
      assert.equal(result, true);

      const afterDelete = useAppStore.getState().presets;
      assert.equal(afterDelete.length, 1);

      console.log('✅ store.deletePreset 集成测试通过');
    });

    it('store.duplicatePreset 集成流程', async () => {
      const presets = useAppStore.getState().presets;
      const toDuplicate = presets[0];

      const result = await useAppStore.getState().duplicatePreset(
        toDuplicate.id,
        '复制的Store测试导出',
        'store_test'
      );

      assert.ok(result);
      assert.equal(useAppStore.getState().presets.length, 2);

      console.log('✅ store.duplicatePreset 集成测试通过');
    });
  });
});
