import * as XLSX from 'xlsx';
import type {
  ExportOptions,
  ReportData,
  Anomaly,
  AnomalyType,
} from '../../types';
import { formatDateTime, formatDuration, formatDate } from '../../utils/dateUtils';
import { ANOMALY_TYPE_LABELS, ANOMALY_SEVERITY_COLORS } from '../rules';

const ANOMALY_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  corrected: '已修正',
  ignored: '已忽略',
  confirmed: '已确认',
};

const ANOMALY_SEVERITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

export const generateHTMLReport = (
  data: ReportData,
  options: ExportOptions
): string => {
  const { batch, summary, anomalies, corrections, trendData, employeeStats, departmentStats, ruleVersion } = data;
  const title = options.title || '排班考勤异常对账分析报告';
  const generatedAt = options.generatedAt || new Date();
  
  const anomalyRows = anomalies.map(a => `
    <tr>
      <td>${a.employeeId}</td>
      <td>${a.employeeName || '-'}</td>
      <td>${a.department || '-'}</td>
      <td>${a.scheduleDate}</td>
      <td><span class="badge badge-type" style="background: ${getTypeColor(a.type)}">${ANOMALY_TYPE_LABELS[a.type]}</span></td>
      <td><span class="badge badge-severity" style="background: ${ANOMALY_SEVERITY_COLORS[a.severity]}">${ANOMALY_SEVERITY_LABELS[a.severity]}</span></td>
      <td><span class="badge badge-status" style="background: ${getStatusColor(a.status)}">${ANOMALY_STATUS_LABELS[a.status]}</span></td>
      <td>${a.durationMinutes ? formatDuration(a.durationMinutes) : '-'}</td>
      <td>${a.description}</td>
      <td>${formatDateTime(a.createdAt)}</td>
      <td>${a.correctedAt ? formatDateTime(a.correctedAt) : '-'}</td>
    </tr>
  `).join('');
  
  const typeDistribution = Object.entries(summary.anomaliesByType)
    .filter(([_, count]) => count > 0 && _ !== 'leave_offset')
    .map(([type, count]) => `
      <div class="stat-item">
        <div class="stat-label">${ANOMALY_TYPE_LABELS[type as AnomalyType]}</div>
        <div class="stat-value">${count}</div>
      </div>
    `).join('');
  
  const severityDistribution = Object.entries(summary.anomaliesBySeverity)
    .filter(([_, count]) => count > 0)
    .map(([severity, count]) => `
      <div class="stat-item">
        <div class="stat-label" style="color: ${ANOMALY_SEVERITY_COLORS[severity]}">${ANOMALY_SEVERITY_LABELS[severity]}</div>
        <div class="stat-value">${count}</div>
      </div>
    `).join('');
  
  let trendChart = '';
  if (trendData && options.includeCharts) {
    const maxCount = Math.max(...trendData.map(d => d.count), 1);
    const bars = trendData.map(d => `
      <div class="trend-bar">
        <div class="trend-bar-fill" style="height: ${(d.count / maxCount) * 100}%"></div>
        <div class="trend-bar-value">${d.count}</div>
        <div class="trend-bar-label">${d.date.slice(5)}</div>
      </div>
    `).join('');
    
    trendChart = `
      <div class="chart-section">
        <h3>异常趋势</h3>
        <div class="trend-chart">${bars}</div>
      </div>
    `;
  }
  
  let employeeRanking = '';
  if (employeeStats && employeeStats.length > 0) {
    employeeRanking = `
      <div class="ranking-section">
        <h3>员工异常排行</h3>
        <table class="data-table">
          <thead>
            <tr><th>排名</th><th>员工编号</th><th>员工姓名</th><th>异常数量</th></tr>
          </thead>
          <tbody>
            ${employeeStats.slice(0, 10).map((e, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${e.employeeId}</td>
                <td>${e.employeeName}</td>
                <td>${e.count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  let correctionSection = '';
  if (options.includeCorrections && corrections.length > 0) {
    correctionSection = `
      <div class="section">
        <h3>修正记录</h3>
        <table class="data-table">
          <thead>
            <tr><th>修正类型</th><th>原因</th><th>修正时间</th><th>操作人</th></tr>
          </thead>
          <tbody>
            ${corrections.map(c => `
              <tr>
                <td>${c.type}</td>
                <td>${c.reason}</td>
                <td>${formatDateTime(c.createdAt)}</td>
                <td>${c.createdBy}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.6;
      padding: 40px 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { 
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      color: white;
      padding: 40px;
      border-radius: 12px;
      margin-bottom: 30px;
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header .subtitle { opacity: 0.9; font-size: 14px; }
    .header .meta { margin-top: 16px; opacity: 0.8; font-size: 13px; }
    .section { 
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .section h3 { 
      font-size: 18px; 
      margin-bottom: 16px; 
      color: #1e3a5f;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
    }
    .stats-grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: #f8fafc;
      border-radius: 8px;
      padding: 16px;
      border-left: 4px solid #1e3a5f;
    }
    .stat-card .label { font-size: 13px; color: #64748b; margin-bottom: 4px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #1e3a5f; }
    .stat-card.highlight { border-left-color: #f97316; }
    .stat-card.success { border-left-color: #10b981; }
    .stat-card.warning { border-left-color: #f59e0b; }
    .stat-card.danger { border-left-color: #ef4444; }
    .data-table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 13px;
    }
    .data-table th, .data-table td { 
      padding: 10px 12px; 
      text-align: left; 
      border-bottom: 1px solid #e2e8f0;
    }
    .data-table th { 
      background: #f1f5f9; 
      font-weight: 600;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .data-table tbody tr:hover { background: #f8fafc; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      color: white;
    }
    .trend-chart {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 200px;
      padding: 20px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .trend-bar {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 40px;
      height: 100%;
    }
    .trend-bar-fill {
      width: 30px;
      background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
      border-radius: 4px 4px 0 0;
      min-height: 4px;
      transition: height 0.3s ease;
    }
    .trend-bar-value {
      font-size: 12px;
      font-weight: 600;
      margin-top: 4px;
      color: #1e3a5f;
    }
    .trend-bar-label {
      font-size: 11px;
      color: #64748b;
      margin-top: 4px;
    }
    .ranking-section .data-table { max-width: 500px; }
    .footer {
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
    }
    @media print {
      body { background: white; padding: 0; }
      .header { border-radius: 0; }
      .section { box-shadow: none; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
      <div class="subtitle">批次：${batch.name}</div>
      <div class="meta">
        生成时间：${formatDateTime(generatedAt)} | 
        规则版本：${ruleVersion ? `v${ruleVersion.version} - ${ruleVersion.name}` : '默认规则'}
      </div>
    </div>
    
    <div class="section">
      <h3>概览统计</h3>
      <div class="stats-grid">
        <div class="stat-card danger">
          <div class="label">异常总数</div>
          <div class="value">${summary.totalAnomalies}</div>
        </div>
        <div class="stat-card warning">
          <div class="label">待处理</div>
          <div class="value">${summary.pendingCorrections}</div>
        </div>
        <div class="stat-card success">
          <div class="label">已修正</div>
          <div class="value">${summary.correctedCount}</div>
        </div>
        <div class="stat-card">
          <div class="label">已忽略</div>
          <div class="value">${summary.ignoredCount}</div>
        </div>
        <div class="stat-card highlight">
          <div class="label">已确认</div>
          <div class="value">${summary.confirmedCount}</div>
        </div>
        <div class="stat-card success">
          <div class="label">解决率</div>
          <div class="value">${summary.resolutionRate.toFixed(1)}%</div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <h3>异常类型分布</h3>
      <div class="stats-grid">${typeDistribution}</div>
    </div>
    
    <div class="section">
      <h3>严重程度分布</h3>
      <div class="stats-grid">${severityDistribution}</div>
    </div>
    
    ${trendChart}
    ${employeeRanking}
    
    <div class="section">
      <h3>异常明细</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>员工编号</th>
            <th>员工姓名</th>
            <th>部门</th>
            <th>日期</th>
            <th>异常类型</th>
            <th>严重程度</th>
            <th>状态</th>
            <th>时长</th>
            <th>描述</th>
            <th>发现时间</th>
            <th>修正时间</th>
          </tr>
        </thead>
        <tbody>${anomalyRows}</tbody>
      </table>
    </div>
    
    ${correctionSection}
    
    <div class="footer">
      <p>本报告由排班考勤异常对账分析工具自动生成</p>
    </div>
  </div>
</body>
</html>`;
};

export const generateMarkdownReport = (
  data: ReportData,
  options: ExportOptions
): string => {
  const { batch, summary, anomalies, corrections, trendData, employeeStats, departmentStats, ruleVersion } = data;
  const title = options.title || '排班考勤异常对账分析报告';
  const generatedAt = options.generatedAt || new Date();
  
  let content = `# ${title}\n\n`;
  content += `> 批次：${batch.name}\n`;
  content += `> 生成时间：${formatDateTime(generatedAt)}\n`;
  content += ruleVersion ? `> 规则版本：v${ruleVersion.version} - ${ruleVersion.name}\n\n` : '\n';
  
  content += `## 概览统计\n\n`;
  content += `| 指标 | 数值 |\n`;
  content += `|------|------|\n`;
  content += `| 异常总数 | ${summary.totalAnomalies} |\n`;
  content += `| 待处理 | ${summary.pendingCorrections} |\n`;
  content += `| 已修正 | ${summary.correctedCount} |\n`;
  content += `| 已忽略 | ${summary.ignoredCount} |\n`;
  content += `| 已确认 | ${summary.confirmedCount} |\n`;
  content += `| 解决率 | ${summary.resolutionRate.toFixed(1)}% |\n\n`;
  
  content += `## 异常类型分布\n\n`;
  content += `| 异常类型 | 数量 |\n`;
  content += `|----------|------|\n`;
  Object.entries(summary.anomaliesByType)
    .filter(([type, count]) => count > 0 && type !== 'leave_offset')
    .forEach(([type, count]) => {
      content += `| ${ANOMALY_TYPE_LABELS[type as AnomalyType]} | ${count} |\n`;
    });
  content += '\n';
  
  content += `## 严重程度分布\n\n`;
  content += `| 严重程度 | 数量 |\n`;
  content += `|----------|------|\n`;
  Object.entries(summary.anomaliesBySeverity)
    .filter(([_, count]) => count > 0)
    .forEach(([severity, count]) => {
      content += `| ${ANOMALY_SEVERITY_LABELS[severity]} | ${count} |\n`;
    });
  content += '\n';
  
  if (trendData && trendData.length > 0) {
    content += `## 异常趋势\n\n`;
    content += `| 日期 | 异常数量 |\n`;
    content += `|------|----------|\n`;
    trendData.forEach(d => {
      content += `| ${d.date} | ${d.count} |\n`;
    });
    content += '\n';
  }
  
  if (employeeStats && employeeStats.length > 0) {
    content += `## 员工异常排行 (Top 10)\n\n`;
    content += `| 排名 | 员工编号 | 员工姓名 | 异常数量 |\n`;
    content += `|------|----------|----------|----------|\n`;
    employeeStats.slice(0, 10).forEach((e, i) => {
      content += `| ${i + 1} | ${e.employeeId} | ${e.employeeName} | ${e.count} |\n`;
    });
    content += '\n';
  }
  
  content += `## 异常明细\n\n`;
  content += `| 员工编号 | 员工姓名 | 部门 | 日期 | 异常类型 | 严重程度 | 状态 | 时长 | 描述 |\n`;
  content += `|----------|----------|------|------|----------|----------|------|------|------|\n`;
  anomalies.forEach(a => {
    const duration = a.durationMinutes ? formatDuration(a.durationMinutes) : '-';
    content += `| ${a.employeeId} | ${a.employeeName || '-'} | ${a.department || '-'} | ${a.scheduleDate} | ${ANOMALY_TYPE_LABELS[a.type]} | ${ANOMALY_SEVERITY_LABELS[a.severity]} | ${ANOMALY_STATUS_LABELS[a.status]} | ${duration} | ${a.description.replace(/\|/g, '\\|')} |\n`;
  });
  content += '\n';
  
  if (options.includeCorrections && corrections.length > 0) {
    content += `## 修正记录\n\n`;
    content += `| 修正类型 | 原因 | 修正时间 | 操作人 |\n`;
    content += `|----------|------|----------|--------|\n`;
    corrections.forEach(c => {
      content += `| ${c.type} | ${c.reason.replace(/\|/g, '\\|')} | ${formatDateTime(c.createdAt)} | ${c.createdBy} |\n`;
    });
    content += '\n';
  }
  
  if (options.includeRawData) {
    content += `## 原始数据\n\n`;
    content += `> 本报告包含 ${anomalies.length} 条异常记录，${corrections.length} 条修正记录\n\n`;
  }
  
  if (ruleVersion) {
    content += `---\n\n`;
    content += `*规则版本信息：v${ruleVersion.version} - ${ruleVersion.name}*\n`;
    content += `*${ruleVersion.description}*\n`;
  }
  
  return content;
};

export const generateExcelReport = (
  data: ReportData,
  options: ExportOptions
): Blob => {
  const { batch, summary, anomalies, corrections, employeeStats } = data;
  
  const wb = XLSX.utils.book_new();
  
  const summaryData = [
    ['排班考勤异常对账分析报告'],
    ['批次', batch.name],
    ['生成时间', formatDateTime(options.generatedAt || new Date())],
    [],
    ['概览统计'],
    ['指标', '数值'],
    ['异常总数', summary.totalAnomalies],
    ['待处理', summary.pendingCorrections],
    ['已修正', summary.correctedCount],
    ['已忽略', summary.ignoredCount],
    ['已确认', summary.confirmedCount],
    ['解决率', `${summary.resolutionRate.toFixed(1)}%`],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), '概览');
  
  const typeData = [
    ['异常类型', '数量'],
    ...Object.entries(summary.anomaliesByType)
      .filter(([type]) => type !== 'leave_offset')
      .map(([type, count]) => [ANOMALY_TYPE_LABELS[type as AnomalyType], count])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(typeData), '类型分布');
  
  const anomalyData = [
    ['员工编号', '员工姓名', '部门', '日期', '异常类型', '严重程度', '状态', '时长(分钟)', '描述', '发现时间', '修正时间'],
    ...anomalies.map(a => [
      a.employeeId,
      a.employeeName || '',
      a.department || '',
      a.scheduleDate,
      ANOMALY_TYPE_LABELS[a.type],
      ANOMALY_SEVERITY_LABELS[a.severity],
      ANOMALY_STATUS_LABELS[a.status],
      a.durationMinutes || '',
      a.description,
      formatDateTime(a.createdAt),
      a.correctedAt ? formatDateTime(a.correctedAt) : ''
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(anomalyData), '异常明细');
  
  if (options.includeCorrections && corrections.length > 0) {
    const correctionData = [
      ['修正类型', '旧值', '新值', '原因', '修正时间', '操作人'],
      ...corrections.map(c => [
        c.type,
        c.oldValue,
        c.newValue,
        c.reason,
        formatDateTime(c.createdAt),
        c.createdBy
      ])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(correctionData), '修正记录');
  }
  
  if (employeeStats && employeeStats.length > 0) {
    const empData = [
      ['排名', '员工编号', '员工姓名', '异常数量'],
      ...employeeStats.map((e, i) => [i + 1, e.employeeId, e.employeeName, e.count])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empData), '员工排行');
  }
  
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export const generateCSVReport = (
  data: ReportData,
  options: ExportOptions
): string => {
  const { anomalies } = data;
  
  const headers = ['员工编号', '员工姓名', '部门', '日期', '异常类型', '严重程度', '状态', '时长(分钟)', '描述', '发现时间', '修正时间'];
  
  const rows = anomalies.map(a => [
    a.employeeId,
    a.employeeName || '',
    a.department || '',
    a.scheduleDate,
    ANOMALY_TYPE_LABELS[a.type],
    ANOMALY_SEVERITY_LABELS[a.severity],
    ANOMALY_STATUS_LABELS[a.status],
    a.durationMinutes || '',
    `"${a.description.replace(/"/g, '""')}"`,
    formatDateTime(a.createdAt),
    a.correctedAt ? formatDateTime(a.correctedAt) : ''
  ]);
  
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const downloadReport = (
  content: string | Blob,
  filename: string,
  format: string
): void => {
  let blob: Blob;
  let mimeType: string;
  
  switch (format) {
    case 'html':
      mimeType = 'text/html;charset=utf-8';
      blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
      break;
    case 'markdown':
      mimeType = 'text/markdown;charset=utf-8';
      blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
      break;
    case 'csv':
      mimeType = 'text/csv;charset=utf-8';
      blob = typeof content === 'string' ? new Blob(['\ufeff' + content], { type: mimeType }) : content;
      break;
    case 'excel':
      blob = content as Blob;
      break;
    default:
      mimeType = 'application/octet-stream';
      blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  }
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const getTypeColor = (type: AnomalyType): string => {
  const colors: Record<AnomalyType, string> = {
    late: '#f59e0b',
    early_leave: '#f59e0b',
    missing_punch: '#ef4444',
    missing_punch_in: '#ef4444',
    missing_punch_out: '#ef4444',
    cross_day: '#8b5cf6',
    duplicate: '#6b7280',
    leave_offset: '#10b981',
    overtime: '#3b82f6',
    timezone_error: '#ec4899',
    no_schedule: '#6366f1',
    no_punch: '#f97316',
  };
  return colors[type] || '#6b7280';
};

const getStatusColor = (status: string): string => {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    corrected: '#10b981',
    ignored: '#6b7280',
    confirmed: '#ef4444',
  };
  return colors[status] || '#6b7280';
};

export const exportModule = {
  generateHTMLReport,
  generateMarkdownReport,
  generateExcelReport,
  generateCSVReport,
  downloadReport,
};

export default exportModule;
