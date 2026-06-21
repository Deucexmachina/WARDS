import { useEffect, useMemo, useRef, useState } from 'react';
import { branchSettingsAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import ActionConfirmationModal from '../../components/ActionConfirmationModal';
import { CustomSelect, CustomDatePicker } from '../../components/FormControls';
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext';

const PAGE_SIZE = 5;
const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Unavailable / Closed' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'special_operations', label: 'Special Operations Day' },
];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_SYSTEM_SETTINGS = {
  queueEnabled: true,
  maxQueuePerBranch: 100,
  maxQueuePerWindow: 25,
  queueTimeSlot: 15,
  enabledServices: [],
  paymentGatewayEnabled: true,
  receiptRequestEnabled: true,
  maintenanceMode: false,
  serviceOptions: [],
};

const SERVICE_WINDOW_LABELS = {
  RPT: 'Real Property Tax',
  BUSINESS: 'Business Tax',
  MISC: 'Miscellaneous Tax',
  CTC: 'Community Tax Certificate',
  PTR: 'Professional Tax Receipt',
  MARKET: 'Market',
};

const SERVICE_WINDOW_ALIASES = {
  RPT: 'RPT', 'REAL PROPERTY TAX': 'RPT', 'REAL_PROPERTY_TAX': 'RPT',
  BUSINESS: 'BUSINESS', BT: 'BUSINESS', 'BUSINESS TAX': 'BUSINESS', 'BUSINESS_TAX': 'BUSINESS',
  MISC: 'MISC', MISCELLANEOUS: 'MISC', 'MISCELLANEOUS TAX': 'MISC',
  CTC: 'CTC', 'COMMUNITY TAX CERTIFICATE': 'CTC', 'COMMUNITY_TAX_CERTIFICATE': 'CTC',
  PTR: 'PTR', 'PROFESSIONAL TAX RECEIPT': 'PTR', 'PROFESSIONAL_TAX_RECEIPT': 'PTR',
  MARKET: 'MARKET',
};

const normalizeServiceWindowCode = (value) => {
  const rawValue = typeof value === 'string'
    ? value
    : (value?.code || value?.name || value?.service_window || value?.display_label || '');
  const normalized = String(rawValue).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (SERVICE_WINDOW_ALIASES[normalized]) return SERVICE_WINDOW_ALIASES[normalized];
  const withoutWindowSuffix = normalized.replace(/_WINDOW$/, '');
  if (SERVICE_WINDOW_ALIASES[withoutWindowSuffix]) return SERVICE_WINDOW_ALIASES[withoutWindowSuffix];
  const compactWithoutSuffix = withoutWindowSuffix.replace(/[^A-Z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (SERVICE_WINDOW_ALIASES[compactWithoutSuffix]) return SERVICE_WINDOW_ALIASES[compactWithoutSuffix];
  const compact = normalized.replace(/[^A-Z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (SERVICE_WINDOW_ALIASES[compact]) return SERVICE_WINDOW_ALIASES[compact];
  if (/^QW\d+$/.test(compact)) return compact;
  return compact || normalized;
};

const getServiceWindowLabel = (code) => {
  const normalized = normalizeServiceWindowCode(code);
  if (!normalized) return '';
  if (SERVICE_WINDOW_LABELS[normalized]) return SERVICE_WINDOW_LABELS[normalized];
  if (/^QW\d+$/.test(normalized)) return `Window ${normalized.slice(2)}`;
  return normalized;
};

const createEmptyOverride = () => ({ date: '', status: 'unavailable', label: '', notes: '' });

const getUtc8TodayDate = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(new Date());
};

const createDefaultScheduleConfig = (effectiveDate) => ({
  effective_date: effectiveDate,
  weekly_schedule: WEEKDAY_NAMES.map((day) => ({ day, is_available: day !== 'Sunday' })),
  date_overrides: [],
  time_settings: {
    opening_time: '08:00', closing_time: '17:00',
    break_start: '', break_end: '',
    last_appointment_time: '17:00', slot_interval_minutes: 15,
  },
});

const normalizeScheduleConfig = (config, effectiveDate) => {
  const defaults = createDefaultScheduleConfig(effectiveDate);
  const incoming = config || {};
  const incomingWeeklySchedule = Array.isArray(incoming.weekly_schedule) ? incoming.weekly_schedule : [];
  const weeklyLookup = incomingWeeklySchedule.reduce((lookup, entry) => ({
    ...lookup, [entry.day]: Boolean(entry.is_available),
  }), {});
  const incomingTimeSettings = incoming.time_settings || {};
  return {
    ...defaults, ...incoming,
    weekly_schedule: WEEKDAY_NAMES.map((day) => ({
      day,
      is_available: Object.prototype.hasOwnProperty.call(weeklyLookup, day)
        ? weeklyLookup[day]
        : defaults.weekly_schedule.find((e) => e.day === day)?.is_available,
    })),
    date_overrides: Array.isArray(incoming.date_overrides) ? incoming.date_overrides : [],
    time_settings: { ...defaults.time_settings, ...incomingTimeSettings },
  };
};

const normalizeSystemSettings = (settings) => ({
  ...DEFAULT_SYSTEM_SETTINGS, ...(settings || {}),
  enabledServices: Array.isArray(settings?.enabledServices)
    ? settings.enabledServices.map(normalizeServiceWindowCode).filter(Boolean) : [],
  serviceOptions: Array.isArray(settings?.serviceOptions)
    ? settings.serviceOptions.map(normalizeServiceWindowCode).filter(Boolean) : [],
});

const normalizeHistoryState = (history) => ({
  items: Array.isArray(history?.items) ? history.items : [],
  page: Number(history?.page || 1),
  page_size: Number(history?.page_size || PAGE_SIZE),
  total: Number(history?.total || 0),
  total_pages: Number(history?.total_pages || 1),
});

const getAvailableDaysLabel = (weeklySchedule = []) => {
  const enabledDays = weeklySchedule.filter((d) => d.is_available).map((d) => d.day);
  return enabledDays.length ? enabledDays.join(', ') : 'No open days configured';
};

const formatTimeWindow = (timeSettings = {}) => {
  if (!timeSettings.opening_time || !timeSettings.closing_time) return 'Not configured';
  return `${timeSettings.opening_time} - ${timeSettings.closing_time}`;
};

const formatDisplayTime = (value) => {
  if (!value) return 'Not configured';
  const [hours, minutes] = String(value).split(':');
  const parsed = new Date();
  parsed.setHours(Number(hours || 0), Number(minutes || 0), 0, 0);
  return parsed.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
};

const formatDisplayDate = (value) => {
  if (!value) return 'Not configured';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
};

const formatBreakPeriod = (timeSettings = {}) => {
  if (!timeSettings.break_start || !timeSettings.break_end) return 'No scheduled break';
  return `${formatDisplayTime(timeSettings.break_start)} - ${formatDisplayTime(timeSettings.break_end)}`;
};

const formatOverrideSummary = (dateOverrides = []) => {
  if (!dateOverrides.length) return 'No date-specific overrides';
  const labels = dateOverrides.filter((o) => o?.date).slice(0, 3).map((o) => {
    const statusLabel = STATUS_OPTIONS.find((opt) => opt.value === o.status)?.label || o.status || 'Custom status';
    return `${formatDisplayDate(o.date)} (${statusLabel})`;
  });
  if (!labels.length) return `${dateOverrides.length} override${dateOverrides.length === 1 ? '' : 's'} configured`;
  return `${dateOverrides.length} override${dateOverrides.length === 1 ? '' : 's'}: ${labels.join(', ')}${dateOverrides.length > 3 ? ', and more' : ''}`;
};

const formatAuditSettingValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (value === null || value === undefined || value === '') return 'None';
  return String(value);
};

const buildSystemSettingsSummary = (config = {}) => ([
  { label: 'Queue Availability', value: formatAuditSettingValue(config.queueEnabled) },
  { label: 'Enabled Service Windows', value: formatAuditSettingValue(config.enabledServices) },
  { label: 'Max Queue Per Branch', value: formatAuditSettingValue(config.maxQueuePerBranch) },
  { label: 'Max Queue Per Window', value: formatAuditSettingValue(config.maxQueuePerWindow) },
  { label: 'Queue Time Slot', value: config.queueTimeSlot ? `${config.queueTimeSlot} minutes` : 'None' },
  { label: 'Payment Gateway', value: formatAuditSettingValue(config.paymentGatewayEnabled) },
  { label: 'Receipt Request', value: formatAuditSettingValue(config.receiptRequestEnabled) },
  { label: 'Maintenance Mode', value: formatAuditSettingValue(config.maintenanceMode) },
]);

const buildScheduleSummary = (config = {}) => ([
  { label: 'Effective Date', value: formatDisplayDate(config.effective_date) },
  { label: 'Appointment Days', value: getAvailableDaysLabel(config.weekly_schedule || []) },
  { label: 'Operating Hours', value: formatTimeWindow(config.time_settings || {}) },
  { label: 'Break Period', value: formatBreakPeriod(config.time_settings || {}) },
  { label: 'Last Appointment Cutoff', value: formatDisplayTime(config.time_settings?.last_appointment_time) },
  { label: 'Slot Interval', value: config.time_settings?.slot_interval_minutes ? `${config.time_settings.slot_interval_minutes} minutes` : 'Not configured' },
  { label: 'Date Overrides', value: formatOverrideSummary(config.date_overrides || []) },
]);

const getViewedPublishedHistoryStorageKey = (branchUser) => {
  const branchId = branchUser?.branch_id || 'unknown-branch';
  const username = branchUser?.username || branchUser?.full_name || 'unknown-user';
  return `branchViewedPublishedHistory:${branchId}:${username}`;
};

const showSystemSuccessMessage = ({ title, message }) => {
  window.dispatchEvent(new CustomEvent('wards:system-message', {
    detail: { tone: 'success', title, message, buttonLabel: 'OK' },
  }));
};

const showSystemErrorMessage = ({ title, message }) => {
  window.dispatchEvent(new CustomEvent('wards:system-message', {
    detail: { tone: 'error', title, message, buttonLabel: 'OK' },
  }));
};

/* ─────────────────────────────────────────────────── */
/*  Shared mini-components that match the app pattern  */
/* ─────────────────────────────────────────────────── */
const SectionCard = ({ title, subtitle, headerRight, children }) => (
  <div className="rounded-xl bg-white shadow">
    <div className="bg-primary px-6 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-blue-100">{subtitle}</p>}
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
    </div>
    <div>{children}</div>
  </div>
);

const SettingRow = ({ label, description, control, noBorder = false }) => (
  <div className={`flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between ${noBorder ? '' : 'border-b border-gray-100'}`}>
    <div className="flex-1">
      <p className="font-semibold text-gray-800">{label}</p>
      {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
    </div>
    <div className="shrink-0">{control}</div>
  </div>
);

const CheckboxToggle = ({ checked, onChange, disabled = false, label }) => (
  <label className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
    <span className={`text-sm font-semibold ${checked ? 'text-green-600' : 'text-gray-400'}`}>
      {label || (checked ? 'Enabled' : 'Disabled')}
    </span>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="h-4 w-4 accent-green-500"
    />
  </label>
);

const SummaryTable = ({ items }) => (
  <div className="divide-y divide-gray-100">
    {items.map((item) => (
      <div key={item.label} className="flex items-start justify-between gap-4 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 w-40 shrink-0">{item.label}</span>
        <span className="text-sm text-gray-700 text-right">{item.value}</span>
      </div>
    ))}
  </div>
);

/* ──────────── */
/*  Main page   */
/* ──────────── */
const BranchSettings = () => {
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isBranchAdmin = branchUser?.role === 'branch_admin' || branchUser?.internal_role === 'branch_admin';
  const todayDate = useMemo(() => getUtc8TodayDate(), []);
  const viewedPublishedHistoryStorageKey = useMemo(() => getViewedPublishedHistoryStorageKey(branchUser), [branchUser]);

  const [schedule, setSchedule] = useState(null);
  const [publishedSchedule, setPublishedSchedule] = useState(null);
  const [systemSettings, setSystemSettings] = useState(null);
  const [publishedSystemSettings, setPublishedSystemSettings] = useState(null);
  const [historyState, setHistoryState] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPublishConfirmModal, setShowPublishConfirmModal] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaError, setMfaError] = useState('');
  const [settingUpMfa, setSettingUpMfa] = useState(false);
  const [showMfaConfirmModal, setShowMfaConfirmModal] = useState(false);
  const [overrideErrors, setOverrideErrors] = useState([]);
  const initialServicesSeeded = useRef(false);
  const navSaveRef = useRef(() => {});
  const { registerDirty } = useUnsavedChanges();
  const [viewedPublishedHistoryIds, setViewedPublishedHistoryIds] = useState(() => {
    try {
      const rawValue = window.localStorage.getItem(getViewedPublishedHistoryStorageKey(JSON.parse(localStorage.getItem('branchUser') || '{}')));
      const parsed = rawValue ? JSON.parse(rawValue) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const fetchSettings = async () => {
    initialServicesSeeded.current = false;
    const [settingsResponse, historyResponse, systemSettingsResponse] = await Promise.all([
      branchSettingsAPI.getAppointmentSettings(),
      branchSettingsAPI.getAppointmentHistory({ page: 1, page_size: PAGE_SIZE }),
      branchSettingsAPI.getSystemSettings(),
    ]);
    const appointmentSettings = settingsResponse.data || {};
    setSchedule(normalizeScheduleConfig(appointmentSettings.draft, todayDate));
    setPublishedSchedule(
      appointmentSettings.published ? normalizeScheduleConfig(appointmentSettings.published, todayDate) : null
    );
    const normalizedSystemSettings = normalizeSystemSettings(systemSettingsResponse.data);
    setSystemSettings(normalizedSystemSettings);
    setPublishedSystemSettings(normalizedSystemSettings);
    setHistoryState(normalizeHistoryState(historyResponse.data));
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError('');
        await fetchSettings();
      } catch (fetchError) {
        console.error('Failed to load branch appointment settings:', fetchError);
        setError(fetchError.response?.data?.detail || 'Failed to load branch appointment settings.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const loadHistoryPage = async (page) => {
    try {
      const response = await branchSettingsAPI.getAppointmentHistory({ page, page_size: PAGE_SIZE });
      setHistoryState(response.data);
    } catch (historyError) {
      console.error('Failed to load appointment setting history:', historyError);
      setError(historyError.response?.data?.detail || 'Failed to load appointment settings history.');
    }
  };

  const handleViewHistoryEntry = (entry) => {
    if (entry.action === 'published') {
      setViewedPublishedHistoryIds((currentIds) => {
        if (currentIds.includes(entry.id)) return currentIds;
        const nextIds = [...currentIds, entry.id];
        window.localStorage.setItem(viewedPublishedHistoryStorageKey, JSON.stringify(nextIds));
        return nextIds;
      });
    }
    setSelectedHistoryEntry(entry);
    setShowHistoryModal(true);
  };

  const closeHistoryModal = () => { setSelectedHistoryEntry(null); setShowHistoryModal(false); };

  const handleDeleteHistoryEntry = (entry) => { setEntryToDelete(entry); setShowDeleteModal(true); };
  const closeDeleteModal = () => { setEntryToDelete(null); setShowDeleteModal(false); };

  const confirmDeleteHistoryEntry = async () => {
    if (!entryToDelete) return;
    try {
      setDeletingHistoryId(entryToDelete.id);
      setError('');
      await branchSettingsAPI.deleteAppointmentHistoryEntry(entryToDelete.id);
      const nextPage = historyState.items.length === 1 && historyState.page > 1
        ? historyState.page - 1 : historyState.page;
      await loadHistoryPage(nextPage);
      closeDeleteModal();
      if (selectedHistoryEntry?.id === entryToDelete.id) closeHistoryModal();
    } catch (deleteError) {
      console.error('Failed to delete appointment settings history:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete appointment settings history.');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const updateWeeklyDay = (dayName, isAvailable) => {
    setSchedule((current) => ({
      ...current,
      weekly_schedule: current.weekly_schedule.map((entry) => (
        entry.day === dayName ? { ...entry, is_available: isAvailable } : entry
      )),
    }));
  };

  const updateTimeSetting = (fieldName, value) => {
    setSchedule((current) => ({
      ...current,
      time_settings: {
        ...current.time_settings,
        [fieldName]: fieldName === 'slot_interval_minutes' ? Number(value) : value,
      },
    }));
  };

  const updateOverride = (index, fieldName, value) => {
    setSchedule((current) => ({
      ...current,
      date_overrides: current.date_overrides.map((entry, i) => (i === index ? { ...entry, [fieldName]: value } : entry)),
    }));
  };

  const addOverride = () => {
    setSchedule((current) => ({ ...current, date_overrides: [...(current?.date_overrides || []), createEmptyOverride()] }));
  };

  const removeOverride = (index) => {
    setSchedule((current) => ({ ...current, date_overrides: current.date_overrides.filter((_, i) => i !== index) }));
    setOverrideErrors((current) => current.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
  };

  const validateOverrides = () => {
    const invalidIndices = [];
    schedule.date_overrides.forEach((override, index) => {
      if (!override.date || !override.status) {
        invalidIndices.push(index);
      }
    });
    setOverrideErrors(invalidIndices);
    return invalidIndices.length === 0;
  };

  const buildPayload = () => ({ ...schedule, reason: reason.trim() || null });

  const buildBranchSystemSettingsPayload = (source = systemSettings, { includeReason = false } = {}) => ({
    queueEnabled: Boolean(source?.queueEnabled),
    maxQueuePerBranch: Number(source?.maxQueuePerBranch || 1),
    maxQueuePerWindow: Number(source?.maxQueuePerWindow || 1),
    queueTimeSlot: Number(source?.queueTimeSlot || 1),
    enabledServices: source?.enabledServices || [],
    paymentGatewayEnabled: Boolean(source?.paymentGatewayEnabled),
    receiptRequestEnabled: Boolean(source?.receiptRequestEnabled),
    maintenanceMode: Boolean(source?.maintenanceMode),
    ...(includeReason ? { reason: reason.trim() || null } : {}),
  });

  const handleSave = async () => {
    if (!validateOverrides()) {
      setError('Please fill in all required Calendar Override fields (Date and Status).');
      return;
    }
    try {
      setSaving(true);
      setError('');
      setSuccessMessage('');
      const response = await branchSettingsAPI.saveAppointmentSettings(buildPayload());
      const appointmentSettings = response.data.schedule || {};
      setSchedule(normalizeScheduleConfig(appointmentSettings.draft, todayDate));
      setPublishedSchedule(
        appointmentSettings.published ? normalizeScheduleConfig(appointmentSettings.published, todayDate) : null
      );
      setSuccessMessage('Draft appointment schedule saved successfully.');
      await loadHistoryPage(1);
    } catch (saveError) {
      console.error('Failed to save appointment settings:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to save appointment settings.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!validateOverrides()) {
      setError('Please fill in all required Calendar Override fields (Date and Status).');
      showSystemErrorMessage({
        title: 'Invalid Calendar Overrides',
        message: 'Some Calendar Overrides are missing required fields. Please fill in the Date and Status for every override before publishing.',
      });
      return;
    }
    try {
      setPublishing(true);
      setError('');
      setSuccessMessage('');
      const nextSystemPayload = buildBranchSystemSettingsPayload(systemSettings, { includeReason: true });
      const comparableSystemPayload = buildBranchSystemSettingsPayload(systemSettings);
      const hasSystemSettingChanges = JSON.stringify(comparableSystemPayload) !== JSON.stringify(buildBranchSystemSettingsPayload(publishedSystemSettings));
      const hasScheduleChanges = JSON.stringify(schedule) !== JSON.stringify(publishedSchedule);

      if (!hasSystemSettingChanges && !hasScheduleChanges) {
        throw new Error('No configuration changes were detected. Update at least one system setting or schedule value before publishing.');
      }

      if (hasSystemSettingChanges) {
        const systemResponse = await branchSettingsAPI.saveSystemSettings(nextSystemPayload);
        const normalizedUpdatedSettings = normalizeSystemSettings(systemResponse.data?.settings);
        setSystemSettings(normalizedUpdatedSettings);
        setPublishedSystemSettings(normalizedUpdatedSettings);
      }

      if (hasScheduleChanges) {
        const response = await branchSettingsAPI.publishAppointmentSettings(buildPayload());
        const appointmentSettings = response.data.schedule || {};
        setSchedule(normalizeScheduleConfig(appointmentSettings.draft, todayDate));
        setPublishedSchedule(
          appointmentSettings.published ? normalizeScheduleConfig(appointmentSettings.published, todayDate) : null
        );
        if (response.data.notice) window.dispatchEvent(new Event('branch-policy-updated'));
      }

      const usedServiceWindowMessaging = hasServiceWindowChanges && !hasScheduleChanges;
      showSystemSuccessMessage({
        title: usedServiceWindowMessaging ? 'Service Window Settings Updated' : 'System Settings Published Successfully',
        message: usedServiceWindowMessaging
          ? 'The Service Window availability settings have been successfully saved and published.'
          : 'Your system configuration changes have been successfully saved and published.',
      });
      setSuccessMessage('');
      setReason('');
      setShowPublishConfirmModal(false);
      await Promise.all([fetchSettings(), loadHistoryPage(1)]);
    } catch (publishError) {
      console.error('Failed to publish appointment settings:', publishError);
      const detail = publishError.response?.data?.detail || publishError.message || 'An error occurred while saving and publishing the system settings. Please try again.';
      setError(detail);
      const usedServiceWindowMessaging = hasServiceWindowChanges;
      showSystemErrorMessage({
        title: usedServiceWindowMessaging ? 'Unable to Update Service Window Settings' : 'Unable to Publish System Settings',
        message: usedServiceWindowMessaging
          ? 'An error occurred while updating the Service Window availability settings. Please try again.'
          : 'An error occurred while saving and publishing the system settings. Please try again.',
      });
    } finally {
      setPublishing(false);
    }
  };

  navSaveRef.current = async () => { await handlePublish(); };

  const isSettingsDirty = useMemo(() => {
    if (loading) return false;
    const scheduleChanged = JSON.stringify(schedule) !== JSON.stringify(publishedSchedule);
    const systemChanged = JSON.stringify(systemSettings) !== JSON.stringify(publishedSystemSettings);
    return scheduleChanged || systemChanged;
  }, [schedule, publishedSchedule, systemSettings, publishedSystemSettings, loading]);

  useEffect(() => {
    if (isSettingsDirty) {
      registerDirty(true, () => navSaveRef.current());
    } else {
      registerDirty(false, null);
    }
  }, [isSettingsDirty, registerDirty]);

  const handlePublishRequested = () => {
    if (!isBranchAdmin || publishing) return;
    setShowPublishConfirmModal(true);
  };

  const handleResetMfa = async () => {
    try {
      setSettingUpMfa(true);
      setMfaError('');
      const response = await branchSettingsAPI.setupBranchMfa();
      setMfaSetupData(response.data);
    } catch (resetError) {
      console.error('Failed to reset branch MFA:', resetError);
      setMfaError(resetError.response?.data?.detail || 'Failed to prepare MFA reset.');
    } finally {
      setSettingUpMfa(false);
    }
  };

  const summary = useMemo(() => ({
    availableDays: schedule?.weekly_schedule?.filter((d) => d.is_available).length || 0,
    overrides: schedule?.date_overrides?.length || 0,
    publishedOverrides: publishedSchedule?.date_overrides?.length || 0,
    lastPublished: historyState.items.find((item) => item.action === 'published')?.changed_at || null,
  }), [schedule, publishedSchedule, historyState.items]);

  const hasServiceWindowChanges = useMemo(
    () => JSON.stringify((systemSettings?.enabledServices || []).slice().sort()) !== JSON.stringify((publishedSystemSettings?.enabledServices || []).slice().sort()),
    [systemSettings?.enabledServices, publishedSystemSettings?.enabledServices],
  );

  const branchWindowAccounts = useMemo(
    () => (Array.isArray(branchUser?.window_accounts) ? branchUser.window_accounts : []),
    [branchUser],
  );

  const branchQueueWindows = useMemo(() => {
    const windowCount = branchUser?.branch_window_count || 0;
    if (!windowCount) return [];
    const enabledServices = new Set((systemSettings?.enabledServices || []).map(normalizeServiceWindowCode).filter(Boolean));
    const windowAssignments = new Map();
    branchWindowAccounts.forEach((account) => {
      const windowNum = account?.assigned_window_number;
      if (!windowNum || windowNum < 1 || windowNum > windowCount) return;
      const serviceName = normalizeServiceWindowCode(account?.service_window || account?.service_window_label || '');
      if (!serviceName) return;
      windowAssignments.set(windowNum, serviceName);
    });
    return Array.from({ length: windowCount }, (_, i) => {
      const windowNum = i + 1;
      const serviceName = windowAssignments.get(windowNum) || null;
      return {
        windowNumber: windowNum,
        serviceName,
        serviceLabel: serviceName ? getServiceWindowLabel(serviceName) : 'Unassigned',
        enabled: Boolean(systemSettings?.queueEnabled) && serviceName && enabledServices.has(serviceName),
      };
    });
  }, [branchWindowAccounts, branchUser, systemSettings]);

  useEffect(() => {
    if (initialServicesSeeded.current) return;
    if (!systemSettings?.queueEnabled) { initialServicesSeeded.current = true; return; }
    const windowCount = branchUser?.branch_window_count || 0;
    if (!windowCount) return;
    const windowAssignments = new Map();
    branchWindowAccounts.forEach((account) => {
      const windowNum = account?.assigned_window_number;
      if (!windowNum || windowNum < 1 || windowNum > windowCount) return;
      const serviceName = normalizeServiceWindowCode(account?.service_window || account?.service_window_label || '');
      if (!serviceName) return;
      windowAssignments.set(windowNum, serviceName);
    });
    const visibleServiceNames = Array.from({ length: windowCount }, (_, i) => windowAssignments.get(i + 1)).filter(Boolean);
    const currentEnabledServices = (systemSettings.enabledServices || []).map(normalizeServiceWindowCode).filter(Boolean);
    const missingServices = visibleServiceNames.filter((s) => !currentEnabledServices.includes(s));
    initialServicesSeeded.current = true;
    if (!missingServices.length) return;
    setSystemSettings((current) => {
      if (!current?.queueEnabled) return current;
      const nextEnabledServices = Array.from(new Set([
        ...(current.enabledServices || []), ...missingServices,
      ].map(normalizeServiceWindowCode).filter(Boolean))).sort();
      return { ...current, enabledServices: nextEnabledServices };
    });
  }, [branchWindowAccounts, branchUser, systemSettings?.queueEnabled, systemSettings?.enabledServices]);

  const latestPublishedHistoryId = useMemo(
    () => historyState.items.find((item) => item.action === 'published')?.id || null,
    [historyState.items],
  );

  const highlightedPublishedHistoryId = useMemo(() => {
    if (!latestPublishedHistoryId || viewedPublishedHistoryIds.includes(latestPublishedHistoryId)) return null;
    return latestPublishedHistoryId;
  }, [latestPublishedHistoryId, viewedPublishedHistoryIds]);

  const updateBranchSystemSetting = (fieldName, value) => {
    setSystemSettings((current) => {
      if (fieldName === 'queueEnabled') {
        const nextQueueEnabled = Boolean(value);
        const windowCount = branchUser?.branch_window_count || 0;
        const windowAssignments = new Map();
        branchWindowAccounts.forEach((account) => {
          const windowNum = account?.assigned_window_number;
          if (!windowNum || windowNum < 1 || windowNum > windowCount) return;
          const serviceName = normalizeServiceWindowCode(account?.service_window || account?.service_window_label || '');
          if (!serviceName) return;
          windowAssignments.set(windowNum, serviceName);
        });
        const nextEnabledServices = nextQueueEnabled
          ? Array.from({ length: windowCount }, (_, i) => windowAssignments.get(i + 1)).filter(Boolean)
          : current.enabledServices;
        return { ...current, queueEnabled: nextQueueEnabled, enabledServices: nextEnabledServices };
      }
      return { ...current, [fieldName]: value };
    });
  };

  const toggleBranchService = (serviceName) => {
    if (!isBranchAdmin || !systemSettings?.queueEnabled) return;
    setSystemSettings((current) => {
      const isEnabled = current.enabledServices.includes(serviceName);
      const newEnabledServices = isEnabled
        ? current.enabledServices.filter((s) => s !== serviceName)
        : [...current.enabledServices, serviceName].sort();
      return { ...current, enabledServices: newEnabledServices, queueEnabled: newEnabledServices.length > 0 };
    });
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-gray-600">Loading branch settings...</p>
        </div>
      </div>
    );
  }

  if (!schedule || !systemSettings) {
    return (
      <div className="rounded border-l-4 border-red-500 bg-red-100 p-5 text-red-800">
        <p className="font-bold">Branch settings could not load</p>
        <p className="mt-1 text-sm">{error || 'The branch settings response was incomplete. Please reload the page.'}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Reload Settings
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="System Settings"
        subtitle="Configure branch appointment availability by weekday, calendar-date overrides, and operating-hour windows so citizens can only book valid appointment queue slots."
      />

      {/* Quick-glance stats */}
      <div className="flex sm:grid overflow-x-auto sm:overflow-visible snap-x snap-mandatory gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Queue Status', value: systemSettings.queueEnabled ? 'Open' : 'Closed', valueClass: systemSettings.queueEnabled ? 'text-green-600' : 'text-red-500' },
          { label: 'Open Weekdays', value: summary.availableDays, valueClass: 'text-primary' },
          { label: 'Draft Overrides', value: summary.overrides, valueClass: 'text-primary' },
          { label: 'Published Overrides', value: summary.publishedOverrides, valueClass: 'text-primary' },
          { label: 'Last Published', value: summary.lastPublished ? formatUtc8DateTime(summary.lastPublished) : 'Not yet', valueClass: 'text-primary text-base' },
        ].map((card) => (
          <div key={card.label} className="w-[85%] sm:w-auto flex-shrink-0 snap-center rounded-xl bg-white p-4 shadow">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{card.label}</p>
            <p className={`mt-1 text-2xl font-bold leading-tight ${card.valueClass}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Info banners */}
      <div className="rounded border-l-4 border-blue-400 bg-blue-50 p-4 text-blue-900">
        <p className="font-semibold">Branch-only system controls are now available here</p>
        <p className="mt-1 text-sm">Queue status, queue operations, services, and operational defaults below now save for this branch only.</p>
      </div>

      {!isBranchAdmin && (
        <div className="rounded border-l-4 border-yellow-400 bg-yellow-50 p-4 text-yellow-900">
          <p className="font-semibold">View-only access</p>
          <p className="mt-1 text-sm">Only Branch Admin accounts can save or publish appointment scheduling changes.</p>
        </div>
      )}

      {successMessage && (
        <div className="rounded border-l-4 border-green-500 bg-green-100 p-4 text-green-700">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}
      {error && (
        <div className="rounded border-l-4 border-red-500 bg-red-100 p-4 text-red-700">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        {/* ── Left column ── */}
        <div className="space-y-6">

          {/* Queue Operations */}
          <SectionCard
            title="Queue Operations"
            subtitle="Shared queue controls from Main Admin that directly affect branch admin and branch staff queue workflows."
          >
            {[
              ['maxQueuePerBranch', 'Maximum Queue Per Branch', 'Caps the number of active waiting and serving queue entries per branch.'],
              ['maxQueuePerWindow', 'Maximum Queue Per Window', 'Caps the number of active queue entries allowed per staff service window.'],
              ['queueTimeSlot', 'Queue Time Slot', 'Default queue timing in minutes used for branch wait estimates.'],
            ].map(([fieldName, label, description], idx, arr) => (
              <SettingRow
                key={fieldName}
                label={label}
                description={description}
                noBorder={idx === arr.length - 1}
                control={
                  <input
                    type="number"
                    min="1"
                    value={systemSettings[fieldName]}
                    disabled={!isBranchAdmin}
                    onChange={(event) => updateBranchSystemSetting(fieldName, Number(event.target.value))}
                    className="w-28 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-accent disabled:bg-gray-100 disabled:opacity-70"
                  />
                }
              />
            ))}
          </SectionCard>

          {/* Services */}
          <SectionCard
            title="Services"
            subtitle="Shared public-service availability from Main Admin. These settings determine which branch staff services stay active."
          >
            <div className="p-5 space-y-4">
              {/* Queue enable + window grid */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800">Service Window Availability</p>
                    <p className="mt-0.5 text-sm text-gray-500">Toggle individual windows for this branch.</p>
                  </div>
                  <CheckboxToggle
                    checked={Boolean(systemSettings.queueEnabled)}
                    disabled={!isBranchAdmin}
                    label={`Queue: ${systemSettings.queueEnabled ? 'Enabled' : 'Disabled'}`}
                    onChange={(event) => updateBranchSystemSetting('queueEnabled', event.target.checked)}
                  />
                </div>

                {!systemSettings.queueEnabled && (
                  <div className="mb-3 rounded border-l-4 border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
                    Services are automatically turned off while Queue System Availability is disabled.
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {branchQueueWindows.map((window) => (
                    <button
                      key={window.windowNumber}
                      type="button"
                      onClick={() => window.serviceName && toggleBranchService(window.serviceName)}
                      disabled={!isBranchAdmin || !systemSettings.queueEnabled || !window.serviceName}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        window.enabled
                          ? 'border-green-200 bg-green-50 hover:bg-green-100'
                          : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="text-left">
                        <p className="font-semibold text-gray-800">Window {window.windowNumber}</p>
                        <p className="text-xs text-gray-500">{window.serviceLabel}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${window.enabled ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-600'}`}>
                        {window.enabled ? 'On' : 'Off'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {[
                  ['paymentGatewayEnabled', 'Online Payment Gateway Availability', 'Controls whether online tax payments can be started from this branch context.'],
                  ['receiptRequestEnabled', 'Request Receipt Copy Availability', 'Controls whether taxpayers can submit receipt copy requests for this branch.'],
                ].map(([fieldName, label, description], idx, arr) => (
                  <SettingRow
                    key={fieldName}
                    label={label}
                    description={description}
                    noBorder={idx === arr.length - 1}
                    control={
                      <CheckboxToggle
                        checked={Boolean(systemSettings[fieldName])}
                        disabled={!isBranchAdmin}
                        onChange={(event) => updateBranchSystemSetting(fieldName, event.target.checked)}
                      />
                    }
                  />
                ))}
              </div>
            </div>
          </SectionCard>

          {/* Operational Defaults */}
          <SectionCard
            title="Operational Defaults"
            subtitle="System-wide operational switches inherited from Main Admin and applied to branch-facing workflows."
          >
            <SettingRow
              label="Maintenance Mode"
              description="Temporarily disables public-facing operational workflows for this branch while maintenance is ongoing."
              noBorder
              control={
                <CheckboxToggle
                  checked={Boolean(systemSettings.maintenanceMode)}
                  disabled={!isBranchAdmin}
                  label={systemSettings.maintenanceMode ? 'Active' : 'Off'}
                  onChange={(event) => updateBranchSystemSetting('maintenanceMode', event.target.checked)}
                />
              }
            />
          </SectionCard>

          {/* Appointment Days */}
          <SectionCard
            title="Appointment Days"
            subtitle="Enable only the weekdays when this branch should accept appointment queue bookings."
          >
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3 xl:grid-cols-4">
              {schedule.weekly_schedule.map((entry) => (
                <label
                  key={entry.day}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition hover:shadow-sm ${
                    entry.is_available ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
                  } ${!isBranchAdmin ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <div>
                    <p className="font-semibold text-gray-800">{entry.day}</p>
                    <p className={`text-xs ${entry.is_available ? 'text-green-600' : 'text-gray-400'}`}>
                      {entry.is_available ? 'Open' : 'Closed'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={entry.is_available}
                    disabled={!isBranchAdmin}
                    onChange={(event) => updateWeeklyDay(entry.day, event.target.checked)}
                    className="h-4 w-4 accent-green-500"
                  />
                </label>
              ))}
            </div>
          </SectionCard>

          {/* Operating Hours */}
          <SectionCard
            title="Operating Hours & Cutoff"
            subtitle="Set the live appointment window, optional lunch break, and the last time a citizen can still book a slot."
          >
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ['opening_time', 'Opening Time', 'time'],
                ['closing_time', 'Closing Time', 'time'],
                ['last_appointment_time', 'Last Appointment Cutoff', 'time'],
                ['break_start', 'Lunch Break Start', 'time'],
                ['break_end', 'Lunch Break End', 'time'],
                ['slot_interval_minutes', 'Slot Interval (minutes)', 'number'],
              ].map(([field, label, type]) => (
                <div key={field}>
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</label>
                  <input
                    type={type}
                    min={type === 'number' ? '5' : undefined}
                    max={type === 'number' ? '120' : undefined}
                    value={field === 'slot_interval_minutes'
                      ? schedule.time_settings.slot_interval_minutes
                      : schedule.time_settings[field] || ''}
                    disabled={!isBranchAdmin}
                    onChange={(event) => updateTimeSetting(field, event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-accent disabled:bg-gray-100 disabled:opacity-70"
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Calendar Overrides */}
          <SectionCard
            title="Calendar Overrides"
            subtitle="Mark holidays, closures, special operations days, or temporary openings on specific dates."
            headerRight={isBranchAdmin && (
              <button
                onClick={addOverride}
                className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/30"
              >
                + Add Override
              </button>
            )}
          >
            <div className="space-y-4 p-5">
              {schedule.date_overrides.length ? schedule.date_overrides.map((override, index) => (
                <div key={`${override.date || 'new'}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[170px_220px_1fr]">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Date</label>
                      <CustomDatePicker min={todayDate} value={override.date} disabled={!isBranchAdmin} onChange={(event) => { setOverrideErrors((current) => current.filter((i) => i !== index)); updateOverride(index, 'date', event.target.value); }} className={overrideErrors.includes(index) && !override.date ? 'border-red-500 ring-1 ring-red-500' : ''} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Status</label>
                      <CustomSelect value={override.status} disabled={!isBranchAdmin} onChange={(value) => { setOverrideErrors((current) => current.filter((i) => i !== index)); updateOverride(index, 'status', value); }} options={STATUS_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))} placeholder="Select status" className={overrideErrors.includes(index) && !override.status ? 'border-red-500 ring-1 ring-red-500' : ''} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Label / Event Name</label>
                      <input type="text" value={override.label || ''} disabled={!isBranchAdmin} onChange={(event) => updateOverride(index, 'label', event.target.value)} placeholder="E.g. Christmas Day" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:opacity-70" />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Notes / Remarks</label>
                      <textarea value={override.notes || ''} disabled={!isBranchAdmin} onChange={(event) => updateOverride(index, 'notes', event.target.value)} rows="2" placeholder="Add any details staff should know." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:opacity-70" />
                    </div>
                    {isBranchAdmin && (
                      <div className="flex items-end">
                        <button onClick={() => removeOverride(index)} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600">Remove</button>
                      </div>
                    )}
                  </div>
                </div>
              )) : (
                <div className="py-10 text-center text-gray-500">No date overrides added yet.</div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* ── Right column: sticky sidebar ── */}
        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          {/* MFA */}
          <div className="overflow-hidden rounded-xl bg-white shadow">
            <div className="bg-primary px-6 py-4">
              <h2 className="text-lg font-bold text-white">Branch Admin Security</h2>
              <p className="mt-1 text-sm text-blue-100">Account Protection · MFA</p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">
                Reset and re-enroll Microsoft Authenticator for this branch administrator account whenever the device or authentication setup changes.
              </p>
              <div className="rounded border-l-4 border-yellow-400 bg-yellow-50 p-4">
                <p className="font-semibold text-yellow-900">Microsoft Authenticator</p>
                <p className="mt-1 text-sm text-yellow-800">
                  Resetting MFA issues a fresh QR code and manual key so the branch admin can securely reconfigure their authentication method.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMfaConfirmModal(true)}
                disabled={!isBranchAdmin || settingUpMfa}
                className="w-full rounded-lg bg-yellow-500 px-6 py-3 font-semibold text-white transition hover:bg-yellow-600 disabled:opacity-50"
              >
                {settingUpMfa ? 'Preparing MFA...' : 'Reset MFA'}
              </button>
              {!isBranchAdmin && (
                <p className="text-xs text-gray-500">Only Branch Admin accounts can reset and re-enroll MFA.</p>
              )}
              {mfaError && (
                <div className="rounded border-l-4 border-red-500 bg-red-100 p-3 text-sm text-red-700">
                  <p className="font-semibold">{mfaError}</p>
                </div>
              )}
              {mfaSetupData && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <p className="mb-2 font-semibold text-green-900">Scan this QR code in Microsoft Authenticator</p>
                  <p className="mb-4 text-sm text-green-700">Use this new enrollment to complete your MFA reset and secure future branch logins.</p>
                  <div className="mb-4 flex justify-center">
                    <img src={mfaSetupData.qr_code} alt="Branch admin MFA QR code" className="h-52 w-52 rounded-lg border-4 border-white shadow" />
                  </div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-green-700">Manual entry key</p>
                  <code className="block break-all rounded border border-green-200 bg-white p-3 text-xs text-gray-700">
                    {mfaSetupData.manual_entry_key}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* Publish */}
          <div className="rounded-xl bg-white shadow">
            <div className="rounded-t-xl bg-primary px-6 py-4">
              <h2 className="text-lg font-bold text-white">Save &amp; Publish Configuration</h2>
              <p className="mt-1 text-sm text-blue-100">Apply branch changes immediately</p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">
                Save and publish the latest branch system settings and appointment schedule in one step.
              </p>
              <div className="rounded-lg bg-gray-50 p-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">Draft Effective Date</label>
                  <CustomDatePicker
                    min={todayDate}
                    value={schedule.effective_date}
                    disabled={!isBranchAdmin}
                    onChange={(event) => setSchedule((current) => ({ ...current, effective_date: event.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Draft Window</p>
                    <p className="mt-1 font-semibold text-gray-700">{formatTimeWindow(schedule.time_settings)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Published</p>
                    <p className="mt-1 font-semibold text-gray-700">{formatTimeWindow(publishedSchedule?.time_settings || {})}</p>
                  </div>
                </div>
              </div>
              {!isSettingsDirty && (
                <p className="text-xs italic text-gray-400">No changes detected. Modify a setting to enable publishing.</p>
              )}
              <button
                onClick={handlePublishRequested}
                disabled={!isBranchAdmin || publishing || !isSettingsDirty}
                className="w-full rounded-lg bg-green-600 px-5 py-3 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {publishing ? 'Saving & Publishing...' : 'Save and Publish Configuration'}
              </button>
            </div>
          </div>

          {/* Live schedule snapshot */}
          <div className="overflow-hidden rounded-xl bg-white shadow">
            <div className="bg-primary px-6 py-4">
              <h2 className="text-lg font-bold text-white">Live Appointment Schedule</h2>
              <p className="mt-1 text-sm text-blue-100">Published snapshot</p>
            </div>
            <div className="divide-y divide-gray-100">
              {[
                { label: 'Effective Date', value: publishedSchedule?.effective_date || 'Not published' },
                { label: 'Available Days', value: getAvailableDaysLabel(publishedSchedule?.weekly_schedule || []) },
                { label: 'Time Window', value: formatTimeWindow(publishedSchedule?.time_settings || {}) },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-4 px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 w-28 shrink-0">{item.label}</span>
                  <span className="text-sm font-medium text-gray-700 text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Audit History ── */}
      <div className="overflow-hidden rounded-xl bg-white shadow">
        <div className="bg-primary px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Configuration Audit History</h2>
              <p className="mt-1 text-sm text-blue-100">Review branch schedule and system setting changes, who made them, and when.</p>
            </div>
            <span className="self-start rounded-full bg-white/20 px-3 py-1 text-sm font-semibold text-white sm:self-auto">
              {historyState.total} record{historyState.total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {historyState.items.length ? (
          <div className="overflow-x-auto rounded-xl border border-gray-200 md:overflow-hidden">
            <table className="w-full table-auto text-sm min-w-[600px]">
              <thead className="bg-gray-50">
                <tr>
                  {['Entry', 'Type', 'When', 'Changed By', 'Actions'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {historyState.items.map((entry) => {
                  const isSystemSettingsEntry = entry.audit_type === 'system_settings';
                  const isPublishedScheduleEntry = entry.action === 'published';
                  const isHighlighted = entry.id === highlightedPublishedHistoryId && isPublishedScheduleEntry;
                  return (
                    <tr key={entry.id} className={`hover:bg-gray-50 ${isHighlighted ? 'bg-green-50' : ''}`}>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-primary">
                          {isSystemSettingsEntry ? 'Branch System Settings Updated' : isPublishedScheduleEntry ? 'Published Branch Schedule' : 'Saved Draft Schedule'}
                        </p>
                        {isHighlighted && (
                          <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                            Recently Published
                          </span>
                        )}
                        {isSystemSettingsEntry && (
                          <p className="mt-0.5 text-xs text-gray-500">{entry.branch_name || ''}</p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          isSystemSettingsEntry ? 'bg-blue-100 text-blue-800'
                            : isPublishedScheduleEntry ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}>
                          {isSystemSettingsEntry ? 'System Settings' : isPublishedScheduleEntry ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-gray-600">
                        {isSystemSettingsEntry
                          ? (entry.changed_at ? formatUtc8DateTime(entry.changed_at) : 'N/A')
                          : `Effective ${entry.effective_date}`}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-gray-700">
                        {entry.changed_by_full_name || entry.changed_by}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 space-x-2">
                        {isBranchAdmin && (
                          <>
                            <button
                              onClick={() => handleViewHistoryEntry(entry)}
                              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600"
                            >
                              Preview
                            </button>
                            <button
                              onClick={() => handleDeleteHistoryEntry(entry)}
                              disabled={deletingHistoryId === entry.id}
                              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
                            >
                              {deletingHistoryId === entry.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-gray-500">No branch configuration history yet.</div>
        )}

        {historyState.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">Page {historyState.page} of {historyState.total_pages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => loadHistoryPage(historyState.page - 1)}
                disabled={historyState.page <= 1}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                onClick={() => loadHistoryPage(historyState.page + 1)}
                disabled={historyState.page >= historyState.total_pages}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* History detail modal */}
      {showHistoryModal && selectedHistoryEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
            {/* Header */}
            <div className="bg-primary px-6 py-5 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-blue-200">Audit History Detail</p>
                  <h3 className="mt-1 text-xl font-bold text-white">
                    {selectedHistoryEntry.audit_type === 'system_settings'
                      ? 'Branch System Settings Updated'
                      : selectedHistoryEntry.action === 'published' ? 'Published Configuration' : 'Saved Draft'}
                  </h3>
                </div>
                <button onClick={closeHistoryModal} className="shrink-0 rounded-lg p-1.5 text-white/70 transition hover:bg-white/20 hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* What Changed */}
              <div className="rounded-xl border border-gray-200 bg-gray-50">
                <div className="border-b border-gray-200 px-5 py-3">
                  <p className="font-semibold text-gray-700">What Changed</p>
                </div>
                <ul className="divide-y divide-gray-100">
                  {selectedHistoryEntry.change_summary?.length ? selectedHistoryEntry.change_summary.map((line, i) => (
                    <li key={i} className="px-5 py-2.5 text-sm text-gray-700">· {line}</li>
                  )) : <li className="px-5 py-3 text-sm text-gray-400">No change summary available.</li>}
                </ul>
              </div>

              {/* Previous vs Updated side by side */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Previous */}
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="bg-gray-100 px-5 py-3 border-b border-gray-200">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Previous Configuration</p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {(selectedHistoryEntry.audit_type === 'system_settings'
                      ? buildSystemSettingsSummary(selectedHistoryEntry.previous_config || {})
                      : buildScheduleSummary(selectedHistoryEntry.previous_config || {})
                    ).map((item) => (
                      <div key={item.label} className="px-5 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{item.label}</p>
                        <p className="mt-1 text-sm font-medium text-gray-700 break-words">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Updated */}
                <div className="overflow-hidden rounded-xl border border-green-200">
                  <div className="bg-green-50 px-5 py-3 border-b border-green-200">
                    <p className="text-xs font-bold uppercase tracking-wider text-green-600">Updated Configuration</p>
                  </div>
                  <div className="divide-y divide-green-100">
                    {(selectedHistoryEntry.audit_type === 'system_settings'
                      ? buildSystemSettingsSummary(selectedHistoryEntry.new_config || {})
                      : buildScheduleSummary(selectedHistoryEntry.new_config || {})
                    ).map((item) => (
                      <div key={item.label} className="px-5 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-green-500">{item.label}</p>
                        <p className="mt-1 text-sm font-medium text-gray-800 break-words">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Details row */}
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <div className="bg-gray-100 px-5 py-3 border-b border-gray-200">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Details</p>
                </div>
                <div className="grid grid-cols-1 gap-0 divide-y divide-gray-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                  {[
                    {
                      label: selectedHistoryEntry.audit_type === 'system_settings' ? 'Branch' : 'Effective Date',
                      value: selectedHistoryEntry.audit_type === 'system_settings'
                        ? (selectedHistoryEntry.branch_name || 'N/A')
                        : (selectedHistoryEntry.effective_date || 'N/A'),
                    },
                    { label: 'Changed At', value: selectedHistoryEntry.changed_at ? formatUtc8DateTime(selectedHistoryEntry.changed_at) : 'N/A' },
                    { label: 'Changed By', value: selectedHistoryEntry.changed_by_full_name || selectedHistoryEntry.changed_by || 'N/A' },
                    {
                      label: 'Role',
                      value: (selectedHistoryEntry.user_role || 'branch_admin').replace(/_/g, ' '),
                    },
                  ].map((item) => (
                    <div key={item.label} className="px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{item.label}</p>
                      <p className="mt-1 text-sm font-medium text-gray-800 break-words">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="shrink-0 flex justify-end border-t border-gray-100 px-6 py-4">
              <button
                onClick={closeHistoryModal}
                className="rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Delete this audit record?</h3>
                <p className="mt-1 text-sm text-gray-600">This will permanently remove the selected branch configuration audit record.</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Changed At</p>
              <p className="mt-1 text-sm font-medium text-gray-700">
                {entryToDelete.changed_at ? formatUtc8DateTime(entryToDelete.changed_at) : 'N/A'}
              </p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={closeDeleteModal}
                disabled={deletingHistoryId !== null}
                className="rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteHistoryEntry}
                disabled={deletingHistoryId !== null}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-70"
              >
                {deletingHistoryId !== null ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ActionConfirmationModal
        open={showPublishConfirmModal}
        title={hasServiceWindowChanges ? 'Confirm Service Window Changes' : 'Confirm System Settings Changes'}
        message={hasServiceWindowChanges
          ? 'Are you sure you want to save and publish these Service Window configuration changes?'
          : 'Are you sure you want to save and publish these system configuration changes?'}
        confirmLabel="Yes, Publish Changes"
        cancelLabel="Cancel"
        tone="primary"
        isLoading={publishing}
        loadingLabel="Saving and Publishing..."
        onConfirm={handlePublish}
        onCancel={() => setShowPublishConfirmModal(false)}
      />

      {showMfaConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Reset MFA enrollment?</h3>
                <p className="mt-1 text-sm text-gray-600">
                  This will invalidate the current Microsoft Authenticator setup and generate a new QR code. The branch admin will need to re-enroll their device before the next login.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowMfaConfirmModal(false)}
                className="rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowMfaConfirmModal(false); handleResetMfa(); }}
                className="rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-yellow-600"
              >
                Yes, Reset MFA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchSettings;
