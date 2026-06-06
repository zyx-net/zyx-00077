import type {
  Preset,
  PresetType,
  PresetConflict,
  PresetSaveResult,
  PresetApplyResult,
  ImportPresetConfig,
  ExportPresetConfig,
  PresetActionType,
  RuleVersion,
} from '../../types';
import { PRESET_SCHEMA_VERSION } from '../../types';
import { generateId } from '../../utils/dateUtils';
import { presetOperations, ruleVersionOperations } from '../../db';

export interface CreatePresetParams<T = ImportPresetConfig | ExportPresetConfig> {
  name: string;
  description?: string;
  type: PresetType;
  config: T;
  operator?: string;
  ruleVersionId?: string;
  metadata?: Record<string, any>;
}

export interface UpdatePresetParams<T = ImportPresetConfig | ExportPresetConfig> {
  id: string;
  name?: string;
  description?: string;
  config?: T;
  operator?: string;
}

export interface PresetConflictCheckParams {
  name?: string;
  type?: PresetType;
  schemaVersion?: number;
  config?: ImportPresetConfig | ExportPresetConfig;
  ruleVersionId?: string;
  excludeId?: string;
  checkRuleVersion?: boolean;
}

export interface PresetJSONExport {
  version: number;
  schemaVersion: number;
  exportedAt: string;
  presets: Preset[];
}

export const createPreset = async <T extends ImportPresetConfig | ExportPresetConfig>(
  params: CreatePresetParams<T>
): Promise<Preset<T>> => {
  const now = new Date();
  const preset: Preset<T> = {
    id: generateId(),
    name: params.name,
    description: params.description,
    type: params.type,
    config: params.config,
    version: 1,
    schemaVersion: 1,
    ruleVersionId: params.ruleVersionId,
    createdAt: now,
    updatedAt: now,
    createdBy: params.operator || 'user',
    metadata: params.metadata || {},
  };

  if (params.ruleVersionId) {
    const ruleVersion = await ruleVersionOperations.getById(params.ruleVersionId);
    if (ruleVersion) {
      preset.ruleVersionName = ruleVersion.name;
    }
  }

  await presetOperations.add(preset as Preset);
  return preset;
};

export const checkConflicts = async (
  params: PresetConflictCheckParams
): Promise<PresetConflict[]> => {
  const conflicts: PresetConflict[] = [];

  if (params.name) {
    const allPresets = await presetOperations.getAll();
    const existing = allPresets.find(
      p => p.name === params.name && p.id !== params.excludeId
    );
    if (existing) {
      conflicts.push({
        type: 'name_exists',
        message: `已存在同名预设：${params.name}`,
        details: { existingId: existing.id, existingName: existing.name, existingType: existing.type },
      });
    }
  }

  if (params.schemaVersion !== undefined && params.schemaVersion !== 1) {
    conflicts.push({
      type: 'version_incompatible',
      message: `预设版本不兼容：当前版本 1，导入版本 ${params.schemaVersion}`,
      details: { current: 1, imported: params.schemaVersion },
    });
  }

  if (params.config) {
    const missingFields = validateConfigFields(params.config, params.type!);
    if (missingFields.length > 0) {
      conflicts.push({
        type: 'missing_fields',
        message: `配置缺少必要字段：${missingFields.join(', ')}`,
        details: { missingFields },
      });
    }
  }

  if (params.ruleVersionId && params.checkRuleVersion !== false) {
    const currentActive = await ruleVersionOperations.getActive();
    if (currentActive && currentActive.id !== params.ruleVersionId) {
      conflicts.push({
        type: 'rules_changed',
        message: `预设关联的规则版本已不是当前激活版本`,
        details: {
          presetRuleVersionId: params.ruleVersionId,
          currentActiveRuleVersionId: currentActive.id,
          currentActiveRuleVersionName: currentActive.name,
        },
      });
    }
  }

  return conflicts;
};

const validateConfigFields = (
  config: ImportPresetConfig | ExportPresetConfig,
  type: PresetType
): string[] => {
  const missing: string[] = [];

  if (type === 'import') {
    const importConfig = config as ImportPresetConfig;
    if (!importConfig.fieldMapping) missing.push('fieldMapping');
    if (!importConfig.timezone) missing.push('timezone');
    if (importConfig.duplicatePunchWindowMinutes === undefined) missing.push('duplicatePunchWindowMinutes');
    
    if (importConfig.fieldMapping) {
      if (!importConfig.fieldMapping.schedule) missing.push('fieldMapping.schedule');
      if (!importConfig.fieldMapping.punch) missing.push('fieldMapping.punch');
      if (!importConfig.fieldMapping.leave) missing.push('fieldMapping.leave');
    }
  } else {
    const exportConfig = config as ExportPresetConfig;
    if (!exportConfig.format) missing.push('format');
    if (exportConfig.includeCharts === undefined) missing.push('includeCharts');
    if (exportConfig.includeAuditSummary === undefined) missing.push('includeAuditSummary');
  }

  return missing;
};

export const savePreset = async <T extends ImportPresetConfig | ExportPresetConfig>(
  params: CreatePresetParams<T>,
  overwrite: boolean = false
): Promise<PresetSaveResult> => {
  const conflicts = await checkConflicts({
    name: params.name,
    type: params.type,
    config: params.config,
    ruleVersionId: params.ruleVersionId,
  });

  const nameConflict = conflicts.find(c => c.type === 'name_exists');
  if (nameConflict && !overwrite) {
    return {
      success: false,
      conflicts,
      requiresConfirmation: true,
    };
  }

  if (nameConflict && overwrite) {
    const existing = await presetOperations.getByName(params.name, params.type);
    if (existing) {
      const updatedPreset: Preset<T> = {
        ...existing,
        name: params.name,
        description: params.description || existing.description,
        config: params.config,
        version: existing.version + 1,
        ruleVersionId: params.ruleVersionId || existing.ruleVersionId,
        updatedAt: new Date(),
        metadata: { ...existing.metadata, ...params.metadata },
      } as Preset<T>;

      if (params.ruleVersionId) {
        const ruleVersion = await ruleVersionOperations.getById(params.ruleVersionId);
        if (ruleVersion) {
          updatedPreset.ruleVersionName = ruleVersion.name;
        }
      }

      await presetOperations.update(updatedPreset as Preset);
      return {
        success: true,
        preset: updatedPreset,
        requiresConfirmation: false,
      };
    }
  }

  const nonNameConflicts = conflicts.filter(c => c.type !== 'name_exists');
  if (nonNameConflicts.length > 0 && !overwrite) {
    return {
      success: false,
      conflicts: nonNameConflicts,
      requiresConfirmation: true,
    };
  }

  const preset = await createPreset(params);
  return {
    success: true,
    preset,
    requiresConfirmation: false,
  };
};

export const updatePreset = async <T extends ImportPresetConfig | ExportPresetConfig>(
  params: UpdatePresetParams<T>
): Promise<Preset<T> | null> => {
  const existing = await presetOperations.getById(params.id);
  if (!existing) return null;

  const conflicts = await checkConflicts({
    name: params.name,
    type: existing.type,
    excludeId: params.id,
  });

  if (conflicts.length > 0) {
    throw new Error(conflicts.map(c => c.message).join('; '));
  }

  const updatedPreset: Preset<T> = {
    ...existing,
    name: params.name || existing.name,
    description: params.description !== undefined ? params.description : existing.description,
    config: params.config || existing.config,
    version: existing.version + 1,
    updatedAt: new Date(),
  } as Preset<T>;

  await presetOperations.update(updatedPreset as Preset);
  return updatedPreset;
};

export const duplicatePreset = async (
  presetId: string,
  newName: string,
  operator?: string
): Promise<Preset | null> => {
  const existing = await presetOperations.getById(presetId);
  if (!existing) return null;

  const conflicts = await checkConflicts({
    name: newName,
    type: existing.type,
  });

  if (conflicts.length > 0) {
    throw new Error(conflicts.map(c => c.message).join('; '));
  }

  const now = new Date();
  const duplicated: Preset = {
    ...existing,
    id: generateId(),
    name: newName,
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: operator || 'user',
    metadata: { ...existing.metadata, duplicatedFrom: presetId },
  };

  await presetOperations.add(duplicated);
  return duplicated;
};

export const deletePreset = async (presetId: string): Promise<boolean> => {
  const existing = await presetOperations.getById(presetId);
  if (!existing) return false;

  await presetOperations.delete(presetId);
  return true;
};

export const getPresets = async (type?: PresetType): Promise<Preset[]> => {
  if (type) {
    return presetOperations.getByType(type);
  }
  return presetOperations.getAll();
};

export const getPresetById = async (presetId: string): Promise<Preset | undefined> => {
  return presetOperations.getById(presetId);
};

export const applyPreset = async (
  presetId: string
): Promise<PresetApplyResult> => {
  const preset = await presetOperations.getById(presetId);
  if (!preset) {
    return {
      success: false,
      requiresConfirmation: false,
      conflicts: [{
        type: 'missing_fields',
        message: '预设不存在',
      }],
    };
  }

  const conflicts = await checkConflicts({
    schemaVersion: preset.schemaVersion,
    config: preset.config,
    type: preset.type,
    ruleVersionId: preset.ruleVersionId,
    checkRuleVersion: !!preset.ruleVersionId,
  });

  if (conflicts.length > 0) {
    return {
      success: false,
      preset,
      conflicts,
      requiresConfirmation: true,
    };
  }

  return {
    success: true,
    preset,
    requiresConfirmation: false,
  };
};

export const exportPresetsToJSON = async (
  presetIds?: string[]
): Promise<PresetJSONExport> => {
  let presets: Preset[];
  
  if (presetIds && presetIds.length > 0) {
    presets = [];
    for (const id of presetIds) {
      const preset = await presetOperations.getById(id);
      if (preset) {
        presets.push(preset);
      }
    }
  } else {
    presets = await presetOperations.getAll();
  }

  return {
    version: 1,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    presets: JSON.parse(JSON.stringify(presets)),
  };
};

export const importPresetsFromJSON = async (
  jsonData: PresetJSONExport,
  operator?: string
): Promise<{
  imported: Preset[];
  skipped: { preset: Preset; reason: string }[];
  conflicts: { preset: Preset; conflicts: PresetConflict[] }[];
}> => {
  const imported: Preset[] = [];
  const skipped: { preset: Preset; reason: string }[] = [];
  const conflicts: { preset: Preset; conflicts: PresetConflict[] }[] = [];

  if (jsonData.schemaVersion !== 1) {
    throw new Error(`不支持的预设 schema 版本：${jsonData.schemaVersion}`);
  }

  for (const presetData of jsonData.presets) {
    try {
      const presetConflicts = await checkConflicts({
        name: presetData.name,
        type: presetData.type,
        schemaVersion: presetData.schemaVersion,
        config: presetData.config,
        ruleVersionId: presetData.ruleVersionId,
        checkRuleVersion: !!presetData.ruleVersionId,
      });

      if (presetConflicts.length > 0) {
        conflicts.push({ preset: presetData, conflicts: presetConflicts });
        continue;
      }

      const now = new Date();
      const newPreset: Preset = {
        ...presetData,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        createdBy: operator || 'user',
        metadata: {
          ...presetData.metadata,
          importedFrom: presetData.id,
          importedAt: now.toISOString(),
        },
      };

      await presetOperations.add(newPreset);
      imported.push(newPreset);
    } catch (error) {
      skipped.push({
        preset: presetData,
        reason: error instanceof Error ? error.message : '未知错误',
      });
    }
  }

  return { imported, skipped, conflicts };
};

export const forceImportPreset = async (
  presetData: Preset,
  overwrite: boolean,
  operator?: string
): Promise<Preset> => {
  const now = new Date();

  if (overwrite) {
    const existing = await presetOperations.getByName(presetData.name, presetData.type);
    if (existing) {
      const updatedPreset: Preset = {
        ...presetData,
        id: existing.id,
        version: existing.version + 1,
        updatedAt: now,
        metadata: {
          ...presetData.metadata,
          importedFrom: presetData.id,
          importedAt: now.toISOString(),
        },
      };
      await presetOperations.update(updatedPreset);
      return updatedPreset;
    }
  }

  let newName = presetData.name;
  let counter = 1;
  while (await presetOperations.getByName(newName, presetData.type)) {
    newName = `${presetData.name} (${counter++})`;
  }

  const newPreset: Preset = {
    ...presetData,
    id: generateId(),
    name: newName,
    createdAt: now,
    updatedAt: now,
    createdBy: operator || 'user',
    metadata: {
      ...presetData.metadata,
      importedFrom: presetData.id,
      importedAt: now.toISOString(),
      originalName: presetData.name,
    },
  };

  await presetOperations.add(newPreset);
  return newPreset;
};

export const generatePresetSummary = (preset: Preset): Record<string, any> => {
  if (preset.type === 'import') {
    const config = preset.config as ImportPresetConfig;
    return {
      type: 'import',
      name: preset.name,
      timezone: config.timezone,
      duplicateWindow: config.duplicatePunchWindowMinutes,
      fieldMappingCount: {
        schedule: Object.keys(config.fieldMapping.schedule).length,
        punch: Object.keys(config.fieldMapping.punch).length,
        leave: Object.keys(config.fieldMapping.leave).length,
      },
    };
  } else {
    const config = preset.config as ExportPresetConfig;
    return {
      type: 'export',
      name: preset.name,
      format: config.format,
      title: config.title,
      includeCharts: config.includeCharts,
      includeAuditSummary: config.includeAuditSummary,
    };
  }
};

export const presetsModule = {
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
};

export default presetsModule;
