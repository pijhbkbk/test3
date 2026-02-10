import '@lark-base-open/js-sdk/dist/style/dashboard.css';
import './App.scss';
import './locales/i18n';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import * as React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { dashboard, bitable, DashboardState, FieldType } from '@lark-base-open/js-sdk';
import type { ITable, IField } from '@lark-base-open/js-sdk';
import { Button, Select, Spin, Empty, Toast, Input, Tooltip } from '@douyinfe/semi-ui';
import { useTheme, useConfig } from './hooks';
import { useTranslation } from 'react-i18next';
import classnames from 'classnames';
import dayjs from 'dayjs';
import { ColorPicker } from './components/ColorPicker';

// ==================== 类型定义 ====================

enum TaskStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  OVERDUE = 'overdue',
  COMPLETED = 'completed',
  OVERDUE_COMPLETED = 'overdue_completed',
}

interface FieldMeta {
  id: string;
  name: string;
  type: FieldType;
}

interface IProjectConfig {
  tableId: string;
  taskFieldId: string;
  planStartFieldId: string;
  planEndFieldId: string;
  actualEndFieldId: string;
  accentColor: string;
  completedColor: string;
  inProgressColor: string;
  overdueColor: string;
  notStartedColor: string;
}

interface ITask {
  id: string;
  name: string;
  planStart: number;
  planEnd: number;
  actualEnd: number | null;
  status: TaskStatus;
  progress: number;
  delayDays: number | null;
}

interface FeishuTextSegment {
  type: string;
  text: string;
}

const PREFERRED_TABLE_ID = 'blkR47dLMTlfF3YK';

const DEFAULT_CONFIG: IProjectConfig = {
  tableId: '',
  taskFieldId: '',
  planStartFieldId: '',
  planEndFieldId: '',
  actualEndFieldId: '',
  accentColor: 'var(--ccm-chart-B500)',
  completedColor: 'var(--ccm-chart-G500)',
  inProgressColor: 'var(--ccm-chart-O500)',
  overdueColor: 'var(--ccm-chart-R400)',
  notStartedColor: 'var(--ccm-chart-N500)',
};

// ==================== 工具函数 ====================

const extractText = (value: any): string => {
  if (!value) return '';

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((segment: FeishuTextSegment) => {
        if (segment && segment.type === 'text' && segment.text) {
          return segment.text;
        }
        return '';
      })
      .join('');
  }

  if (typeof value === 'object' && value !== null) {
    if (value.text) {
      return value.text;
    }
    if (value.content && Array.isArray(value.content)) {
      return extractText(value.content);
    }
  }

  return '';
};

const parseDateValue = (value: any): number | null => {
  if (!value) return null;

  if (typeof value === 'number') {
    return value < 10000000000 ? value * 1000 : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    let parsed = dayjs(trimmed);

    if (parsed.isValid()) {
      return parsed.valueOf();
    }

    const withDashes = trimmed.replace(/\./g, '-');
    parsed = dayjs(withDashes);
    if (parsed.isValid()) {
      return parsed.valueOf();
    }

    const chineseDateMatch = trimmed.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (chineseDateMatch) {
      const [, year, month, day] = chineseDateMatch;
      parsed = dayjs(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      if (parsed.isValid()) {
        return parsed.valueOf();
      }
    }
  }

  return null;
};

const formatDate = (value: number | null): string => {
  if (!value) return '--';
  return dayjs(value).format('YYYY-MM-DD');
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const calculateTaskStatus = (
  planStart: number,
  planEnd: number,
  actualEnd: number | null
): TaskStatus => {
  const now = Date.now();

  if (actualEnd) {
    return actualEnd > planEnd ? TaskStatus.OVERDUE_COMPLETED : TaskStatus.COMPLETED;
  }

  if (now < planStart) {
    return TaskStatus.NOT_STARTED;
  }

  if (now > planEnd) {
    return TaskStatus.OVERDUE;
  }

  return TaskStatus.IN_PROGRESS;
};

const calculateProgress = (
  planStart: number,
  planEnd: number,
  actualEnd: number | null
): number => {
  if (actualEnd) return 1;

  const now = Date.now();
  if (planEnd <= planStart) {
    return now >= planEnd ? 1 : 0;
  }

  const ratio = (now - planStart) / (planEnd - planStart);
  return clamp(ratio, 0, 1);
};

const calculateDelayDays = (
  planEnd: number,
  actualEnd: number | null,
  status: TaskStatus
): number | null => {
  if (status !== TaskStatus.OVERDUE && status !== TaskStatus.OVERDUE_COMPLETED) {
    return null;
  }

  const end = actualEnd ?? Date.now();
  const days = dayjs(end).diff(planEnd, 'day');
  return days > 0 ? days : null;
};

const getStatusText = (status: TaskStatus, t: any): string => {
  switch (status) {
    case TaskStatus.NOT_STARTED:
      return t('status.notStarted') || '未开始';
    case TaskStatus.IN_PROGRESS:
      return t('status.normal') || '进行中';
    case TaskStatus.OVERDUE:
      return t('status.overdue') || '已逾期';
    case TaskStatus.COMPLETED:
      return t('status.completed') || '已完成';
    case TaskStatus.OVERDUE_COMPLETED:
      return t('status.overdue.completed') || '逾期已完成';
    default:
      return '';
  }
};

const getStatusColor = (status: TaskStatus, config: IProjectConfig): string => {
  switch (status) {
    case TaskStatus.NOT_STARTED:
      return config.notStartedColor;
    case TaskStatus.IN_PROGRESS:
      return config.inProgressColor;
    case TaskStatus.OVERDUE:
      return config.overdueColor;
    case TaskStatus.COMPLETED:
      return config.completedColor;
    case TaskStatus.OVERDUE_COMPLETED:
      return config.overdueColor;
    default:
      return config.inProgressColor;
  }
};

const normalizeColor = (value: any, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeConfig = (incoming?: Partial<IProjectConfig>): IProjectConfig => {
  const merged = { ...DEFAULT_CONFIG, ...(incoming || {}) } as IProjectConfig;
  return {
    ...merged,
    accentColor: normalizeColor(merged.accentColor, DEFAULT_CONFIG.accentColor),
    completedColor: normalizeColor(merged.completedColor, DEFAULT_CONFIG.completedColor),
    inProgressColor: normalizeColor(merged.inProgressColor, DEFAULT_CONFIG.inProgressColor),
    overdueColor: normalizeColor(merged.overdueColor, DEFAULT_CONFIG.overdueColor),
    notStartedColor: normalizeColor(merged.notStartedColor, DEFAULT_CONFIG.notStartedColor),
  };
};

const findFieldIdByKeywords = (fields: FieldMeta[], keywords: string[]) => {
  const lowered = keywords.map(keyword => keyword.toLowerCase());
  return fields.find(field =>
    lowered.some(keyword => field.name.toLowerCase().includes(keyword))
  )?.id;
};

// ==================== 主应用组件 ====================

export default function App() {
  const { t, i18n } = useTranslation();
  const { bgColor } = useTheme();

  const [config, setConfig] = useState<IProjectConfig>(normalizeConfig());
  const [isLoading, setIsLoading] = useState(false);

  const isCreate = dashboard.state === DashboardState.Create;
  const isConfig = dashboard.state === DashboardState.Config || isCreate;
  const isFullScreen = dashboard.state === DashboardState.FullScreen;

  useEffect(() => {
    if (isCreate) {
      setConfig(normalizeConfig());
    }
  }, [isCreate, i18n.language]);

  const updateConfig = useCallback((res: any) => {
    const { customConfig } = res;
    if (customConfig) {
      setConfig(normalizeConfig(customConfig as Partial<IProjectConfig>));
      setTimeout(() => {
        dashboard.setRendered();
      }, 3000);
    }
  }, []);

  useConfig(updateConfig);

  const handleSaveConfig = useCallback(() => {
    dashboard.saveConfig({
      customConfig: config as any,
      dataConditions: [],
    });
  }, [config]);

  const themeStyle = {
    backgroundColor: isFullScreen ? 'transparent' : bgColor,
    '--accent-color': config.accentColor,
    '--completed-color': config.completedColor,
    '--in-progress-color': config.inProgressColor,
    '--overdue-color': config.overdueColor,
    '--not-started-color': config.notStartedColor,
  } as React.CSSProperties;

  return (
    <main
      style={themeStyle}
      className={classnames('dashboard-main', {
        'dashboard-config': isConfig,
        'dashboard-fullscreen': isFullScreen,
      })}
    >
      <div className="dashboard-content">
        {isConfig ? (
          <ConfigPanel
            config={config}
            setConfig={setConfig}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
          />
        ) : (
          <ProjectTableView config={config} />
        )}
      </div>
      {isConfig && (
        <div className="dashboard-footer">
          <Button
            theme="solid"
            onClick={handleSaveConfig}
            disabled={
              !config.tableId ||
              !config.taskFieldId ||
              !config.planStartFieldId ||
              !config.planEndFieldId
            }
          >
            {t('confirm')}
          </Button>
        </div>
      )}
    </main>
  );
}

// ==================== 配置面板组件 ====================

interface ConfigPanelProps {
  config: IProjectConfig;
  setConfig: React.Dispatch<React.SetStateAction<IProjectConfig>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

function ConfigPanel({ config, setConfig, isLoading, setIsLoading }: ConfigPanelProps) {
  const { t } = useTranslation();

  const [tables, setTables] = useState<Array<{ id: string; name: string }>>([]);
  const [fields, setFields] = useState<FieldMeta[]>([]);

  const selectedTableId = useMemo(() => config.tableId, [config.tableId]);

  useEffect(() => {
    const loadTables = async () => {
      try {
        const tableList = await bitable.base.getTableList();
        const tableMetaList = await Promise.all(
          tableList.map(async (table: ITable) => {
            const meta = await table.getMeta();
            return { id: meta.id, name: meta.name };
          })
        );
        setTables(tableMetaList);
      } catch (error) {
        console.error('[ConfigPanel] 加载表格失败:', error);
        Toast.error({
          content: t('load.table.failed') || '加载表格失败',
          duration: 3,
        });
      }
    };
    loadTables();
  }, [t]);

  useEffect(() => {
    if (config.tableId || tables.length === 0) return;
    const preferred = tables.find(table => table.id === PREFERRED_TABLE_ID);
    if (preferred) {
      setConfig(prev => ({ ...prev, tableId: preferred.id }));
    }
  }, [tables, config.tableId, setConfig]);

  useEffect(() => {
    if (!selectedTableId) {
      setFields([]);
      return;
    }

    const loadFields = async () => {
      try {
        setIsLoading(true);
        const table = await bitable.base.getTable(selectedTableId);
        const fieldList = await table.getFieldList();

        const fieldMetaList: FieldMeta[] = await Promise.all(
          fieldList.map(async (field: IField) => {
            const meta = await field.getMeta();
            const type = await field.getType();
            return { id: meta.id, name: meta.name, type };
          })
        );

        setFields(fieldMetaList);
      } catch (error) {
        console.error('[ConfigPanel] 加载字段失败:', error);
        Toast.error({
          content: t('load.field.failed') || '加载字段失败',
          duration: 3,
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadFields();
  }, [selectedTableId, setIsLoading, t]);

  useEffect(() => {
    if (!selectedTableId || fields.length === 0) return;

    const updates: Partial<IProjectConfig> = {};

    if (!config.taskFieldId) {
      const match = findFieldIdByKeywords(fields, ['任务', '事项', '步骤', 'task', 'item']);
      if (match) updates.taskFieldId = match;
    }

    if (!config.planStartFieldId) {
      const match = findFieldIdByKeywords(fields, ['开始', 'start', '开工']);
      if (match) updates.planStartFieldId = match;
    }

    if (!config.planEndFieldId) {
      const match = findFieldIdByKeywords(fields, ['截止', '到期', '结束', 'end', 'due']);
      if (match) updates.planEndFieldId = match;
    }

    if (!config.actualEndFieldId) {
      const match = findFieldIdByKeywords(fields, ['实际完成', '实际完成时间', '完成时间', '实际', 'actual']);
      if (match) updates.actualEndFieldId = match;
    }

    if (Object.keys(updates).length > 0) {
      setConfig(prev => ({ ...prev, ...updates }));
    }
  }, [
    selectedTableId,
    fields,
    config.taskFieldId,
    config.planStartFieldId,
    config.planEndFieldId,
    config.actualEndFieldId,
    setConfig,
  ]);

  const getDateFieldOptions = useCallback(() => {
    return fields.filter(field => {
      if (field.type === FieldType.DateTime) return true;
      if (field.type === FieldType.Formula) return true;
      if (field.type === FieldType.Text) {
        const keywords = [
          '时间',
          '日期',
          'date',
          'time',
          '开始',
          '截止',
          '完成',
          'start',
          'end',
        ];
        return keywords.some(keyword =>
          field.name.toLowerCase().includes(keyword.toLowerCase())
        );
      }
      return false;
    });
  }, [fields]);

  const getTextFieldOptions = useCallback(() => {
    return fields.filter(field => {
      if (field.type === FieldType.Text) return true;
      if (field.type === FieldType.Number) return true;
      if (field.type === FieldType.Formula) return true;
      return false;
    });
  }, [fields]);

  const handleTableChange = useCallback(
    (value: string | number | any[] | Record<string, any> | undefined) => {
      setConfig(prev => ({
        ...prev,
        tableId: String(value),
        taskFieldId: '',
        planStartFieldId: '',
        planEndFieldId: '',
        actualEndFieldId: '',
      }));
    },
    [setConfig]
  );

  const handleTaskFieldChange = useCallback(
    (value: string | number | any[] | Record<string, any> | undefined) => {
      setConfig(prev => ({
        ...prev,
        taskFieldId: String(value),
      }));
    },
    [setConfig]
  );

  const updateColor = useCallback(
    (key: keyof IProjectConfig, value: string) => {
      setConfig(prev => ({
        ...prev,
        [key]: value,
      }));
    },
    [setConfig]
  );

  return (
    <div className="config-panel">
      <Spin spinning={isLoading} size="large">
        <div className="config-form">
          <div className="form-section">
            <div className="section-title">{t('config.section.data')}</div>
            <div className="form-item">
              <label className="form-label">{t('select.table')}</label>
              <Select
                placeholder={t('placeholder.table')}
                value={config.tableId}
                onChange={handleTableChange}
                optionList={tables.map(table => ({
                  label: table.name,
                  value: table.id,
                }))}
                className="form-select"
                filter
              />
            </div>

            <div className="form-item">
              <label className="form-label">{t('select.name.field')}</label>
              <Select
                placeholder={t('placeholder.field')}
                value={config.taskFieldId}
                onChange={handleTaskFieldChange}
                optionList={getTextFieldOptions().map(field => ({
                  label: field.name,
                  value: field.id,
                }))}
                className="form-select"
                disabled={!config.tableId}
                filter
              />
            </div>

            <div className="form-item">
              <label className="form-label">{t('select.plan.start.field')}</label>
              <Select
                placeholder={t('placeholder.date.field')}
                value={config.planStartFieldId}
                onChange={(value: string | number | any[] | Record<string, any> | undefined) =>
                  setConfig(prev => ({ ...prev, planStartFieldId: String(value) }))
                }
                optionList={getDateFieldOptions().map(field => ({
                  label: field.name,
                  value: field.id,
                }))}
                className="form-select"
                disabled={!config.tableId}
                filter
              />
            </div>

            <div className="form-item">
              <label className="form-label">{t('select.plan.end.field')}</label>
              <Select
                placeholder={t('placeholder.date.field')}
                value={config.planEndFieldId}
                onChange={(value: string | number | any[] | Record<string, any> | undefined) =>
                  setConfig(prev => ({ ...prev, planEndFieldId: String(value) }))
                }
                optionList={getDateFieldOptions().map(field => ({
                  label: field.name,
                  value: field.id,
                }))}
                className="form-select"
                disabled={!config.tableId}
                filter
              />
            </div>

            <div className="form-item">
              <label className="form-label">{t('select.actual.end.field')}（{t('optional')}）</label>
              <Select
                placeholder={t('placeholder.date.field')}
                value={config.actualEndFieldId}
                onChange={(value: string | number | any[] | Record<string, any> | undefined) =>
                  setConfig(prev => ({
                    ...prev,
                    actualEndFieldId: value ? String(value) : '',
                  }))
                }
                optionList={getDateFieldOptions().map(field => ({
                  label: field.name,
                  value: field.id,
                }))}
                className="form-select"
                disabled={!config.tableId}
                filter
                showClear
              />
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">{t('config.section.colors')}</div>
            <ColorField
              label={t('color.accent')}
              value={config.accentColor}
              onChange={value => updateColor('accentColor', value)}
            />
            <ColorField
              label={t('color.completed')}
              value={config.completedColor}
              onChange={value => updateColor('completedColor', value)}
            />
            <ColorField
              label={t('color.inProgress')}
              value={config.inProgressColor}
              onChange={value => updateColor('inProgressColor', value)}
            />
            <ColorField
              label={t('color.overdue')}
              value={config.overdueColor}
              onChange={value => updateColor('overdueColor', value)}
            />
            <ColorField
              label={t('color.notStarted')}
              value={config.notStartedColor}
              onChange={value => updateColor('notStartedColor', value)}
            />
          </div>

          {!config.tableId && (
            <div className="config-tip">{t('config.tip')}</div>
          )}
        </div>
      </Spin>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="form-item">
      <label className="form-label">{label}</label>
      <div className="color-field">
        <ColorPicker value={value} onChange={onChange} />
        <div className="color-input-row">
          <Input
            size="small"
            value={value}
            onChange={(inputValue: string) => onChange(inputValue)}
            placeholder={t('placeholder.color')}
            className="color-input"
          />
          <div className="color-swatch" style={{ backgroundColor: value }} />
        </div>
      </div>
    </div>
  );
}

// ==================== 仪表盘展示组件 ====================

interface ProjectTableViewProps {
  config: IProjectConfig;
}

function ProjectTableView({ config }: ProjectTableViewProps) {
  const [tasks, setTasks] = useState<ITask[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  const configReady =
    !!config.tableId &&
    !!config.taskFieldId &&
    !!config.planStartFieldId &&
    !!config.planEndFieldId;

  const loadTasks = useCallback(async () => {
    if (!configReady) {
      setTasks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const table = await bitable.base.getTable(config.tableId);
      const response = await table.getRecords({ pageSize: 200 });

      const taskList: ITask[] = response.records
        .map(record => {
          const nameRaw = record.fields[config.taskFieldId];
          const name = extractText(nameRaw);

          const planStartRaw = record.fields[config.planStartFieldId];
          const planEndRaw = record.fields[config.planEndFieldId];
          const actualEndRaw = config.actualEndFieldId
            ? record.fields[config.actualEndFieldId]
            : null;

          const planStart = parseDateValue(planStartRaw);
          const planEnd = parseDateValue(planEndRaw);
          const actualEnd = config.actualEndFieldId
            ? parseDateValue(actualEndRaw)
            : null;

          if (!name || !planStart || !planEnd) {
            return null;
          }

          const status = calculateTaskStatus(planStart, planEnd, actualEnd);
          const progress = calculateProgress(planStart, planEnd, actualEnd);
          const delayDays = calculateDelayDays(planEnd, actualEnd, status);

          return {
            id: record.recordId,
            name,
            planStart,
            planEnd,
            actualEnd,
            status,
            progress,
            delayDays,
          };
        })
        .filter((task): task is ITask => task !== null)
        .sort((a, b) => a.planStart - b.planStart);

      setTasks(taskList);

      if (taskList.length === 0) {
        Toast.warning({
          content: t('no.data.description'),
          duration: 4,
        });
      }
    } catch (error) {
      console.error('[ProjectTableView] 加载任务数据失败:', error);
      Toast.error({
        content: t('load.data.failed') || '数据加载失败',
        duration: 4,
      });
    } finally {
      setLoading(false);
    }
  }, [config, configReady, t]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const offDataChange = dashboard.onDataChange(() => {
      loadTasks();
    });

    return () => {
      offDataChange();
    };
  }, [loadTasks]);

  const summary = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(task => task.status === TaskStatus.COMPLETED).length;
    const overdueCompleted = tasks.filter(task => task.status === TaskStatus.OVERDUE_COMPLETED).length;
    const overdue = tasks.filter(task => task.status === TaskStatus.OVERDUE).length;
    const inProgress = tasks.filter(task => task.status === TaskStatus.IN_PROGRESS).length;
    const notStarted = tasks.filter(task => task.status === TaskStatus.NOT_STARTED).length;
    const doneCount = completed + overdueCompleted;
    const completionRate = total ? Math.round((doneCount / total) * 100) : 0;

    return {
      total,
      completed: doneCount,
      overdueCompleted,
      overdue,
      inProgress,
      notStarted,
      completionRate,
    };
  }, [tasks]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <Spin size="large" />
        <div className="loading-text">{t('loading') || '正在加载数据...'}</div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="dashboard-empty">
        <Empty
          title={t('no.data.title')}
          description={configReady ? t('no.data.description') : t('config.tip')}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <div className="header-main">
          <div className="header-title">{t('dashboard.title')}</div>
          <div className="header-subtitle">
            {t('dashboard.subtitle', { date: dayjs().format('YYYY-MM-DD') })}
          </div>
        </div>
        <div className="header-progress">
          <div className="progress-label">{t('progress.overall')}</div>
          <div className="progress-bar large">
            <div
              className="progress-fill"
              style={{ width: `${summary.completionRate}%` }}
            />
          </div>
          <div className="progress-value">{summary.completionRate}%</div>
        </div>
      </div>

      <div className="summary-grid">
        <SummaryCard label={t('summary.total')} value={summary.total} />
        <SummaryCard label={t('summary.completed')} value={summary.completed} />
        <SummaryCard label={t('summary.inProgress')} value={summary.inProgress} />
        <SummaryCard label={t('summary.overdue')} value={summary.overdue} />
        <SummaryCard label={t('summary.notStarted')} value={summary.notStarted} />
      </div>

      <div className="table-card">
        <div className="table-header">
          <div className="table-cell">{t('table.index')}</div>
          <div className="table-cell">{t('table.task')}</div>
          <div className="table-cell">{t('table.plan.start')}</div>
          <div className="table-cell">{t('table.plan.end')}</div>
          <div className="table-cell">{t('table.actual.end')}</div>
          <div className="table-cell">{t('table.status')}</div>
          <div className="table-cell">{t('table.progress')}</div>
        </div>

        <div className="table-body">
          {tasks.map((task, index) => {
            const statusColor = getStatusColor(task.status, config);
            const delayLabel = task.delayDays
              ? task.status === TaskStatus.OVERDUE
                ? t('delay.overdue', { days: task.delayDays })
                : t('delay.completed', { days: task.delayDays })
              : null;
            const progressPercent = Math.round(task.progress * 100);

            return (
              <div
                key={task.id}
                className="table-row"
                style={{ borderLeftColor: statusColor }}
              >
                <div className="table-cell" data-label={t('table.index')}>
                  {index + 1}
                </div>
                <div className="table-cell task-cell" data-label={t('table.task')}>
                  <Tooltip content={task.name} position="top">
                    <div className="task-name">{task.name}</div>
                  </Tooltip>
                  <div className="task-meta">
                    {formatDate(task.planStart)} → {formatDate(task.planEnd)}
                  </div>
                </div>
                <div className="table-cell mono" data-label={t('table.plan.start')}>
                  {formatDate(task.planStart)}
                </div>
                <div className="table-cell mono" data-label={t('table.plan.end')}>
                  {formatDate(task.planEnd)}
                </div>
                <div className="table-cell mono" data-label={t('table.actual.end')}>
                  {formatDate(task.actualEnd)}
                </div>
                <div className="table-cell status-cell" data-label={t('table.status')}>
                  <span
                    className="status-badge"
                    style={{ color: statusColor, borderColor: statusColor }}
                  >
                    {getStatusText(task.status, t)}
                  </span>
                  {delayLabel && <span className="delay-text">{delayLabel}</span>}
                </div>
                <div className="table-cell progress-cell" data-label={t('table.progress')}>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progressPercent}%`, backgroundColor: statusColor }}
                    />
                  </div>
                  <div className="progress-text">{progressPercent}%</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value}</div>
      <div className="summary-accent" />
    </div>
  );
}
