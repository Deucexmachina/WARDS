import { useEffect, useMemo, useState } from 'react';
import { branchSettingsAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const PAGE_SIZE = 5;
const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Unavailable / Closed' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'special_operations', label: 'Special Operations Day' },
];

const createEmptyOverride = () => ({
  date: '',
  status: 'unavailable',
  label: '',
  notes: '',
});

const getUtc8TodayDate = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

const SummaryCard = ({ label, value, helper }) => (
  <div className="rounded-2xl bg-white p-5 shadow">
    <p className="text-sm font-medium text-slate-500">{label}</p>
    <p className="mt-2 text-3xl font-bold text-primary">{value}</p>
    {helper ? <p className="mt-2 text-sm text-slate-500">{helper}</p> : null}
  </div>
);

const SystemSettingRow = ({ label, value, description, tone = 'slate' }) => {
  const toneClasses = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-slate-200 bg-white text-slate-700';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <p className="font-semibold text-slate-800">{label}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className={`inline-flex min-w-[150px] items-center justify-center rounded-full border px-4 py-3 text-sm font-semibold ${toneClasses}`}>
          {value}
        </div>
      </div>
    </div>
  );
};

const getAvailableDaysLabel = (weeklySchedule = []) => {
  const enabledDays = weeklySchedule.filter((day) => day.is_available).map((day) => day.day);
  return enabledDays.length ? enabledDays.join(', ') : 'No open days configured';
};

const formatTimeWindow = (timeSettings = {}) => {
  if (!timeSettings.opening_time || !timeSettings.closing_time) {
    return 'Not configured';
  }
  return `${timeSettings.opening_time} - ${timeSettings.closing_time}`;
};

const formatDisplayTimeWindow = (timeSettings = {}) => {
  if (!timeSettings.opening_time || !timeSettings.closing_time) {
    return 'Not configured';
  }

  return `${formatDisplayTime(timeSettings.opening_time)} - ${formatDisplayTime(timeSettings.closing_time)}`;
};

const formatDisplayDate = (value) => {
  if (!value) {
    return 'Not configured';
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDisplayTime = (value) => {
  if (!value) {
    return 'Not configured';
  }

  const [hours, minutes] = String(value).split(':');
  const parsed = new Date();
  parsed.setHours(Number(hours || 0), Number(minutes || 0), 0, 0);

  return parsed.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatBreakPeriod = (timeSettings = {}) => {
  if (!timeSettings.break_start || !timeSettings.break_end) {
    return 'No scheduled break';
  }

  return `${formatDisplayTime(timeSettings.break_start)} - ${formatDisplayTime(timeSettings.break_end)}`;
};

const formatOverrideSummary = (dateOverrides = []) => {
  if (!dateOverrides.length) {
    return 'No date-specific overrides';
  }

  const overrideLabels = dateOverrides
    .filter((override) => override?.date)
    .slice(0, 3)
    .map((override) => {
      const statusLabel = STATUS_OPTIONS.find((option) => option.value === override.status)?.label || override.status || 'Custom status';
      return `${formatDisplayDate(override.date)} (${statusLabel})`;
    });

  if (!overrideLabels.length) {
    return `${dateOverrides.length} override${dateOverrides.length === 1 ? '' : 's'} configured`;
  }

  return `${dateOverrides.length} override${dateOverrides.length === 1 ? '' : 's'} configured: ${overrideLabels.join(', ')}${dateOverrides.length > 3 ? ', and more' : ''}`;
};

const buildConfigurationSummary = (config = {}) => ([
  { label: 'Effective Date', value: formatDisplayDate(config.effective_date) },
  { label: 'Appointment Days', value: getAvailableDaysLabel(config.weekly_schedule || []) },
  { label: 'Operating Hours', value: formatDisplayTimeWindow(config.time_settings || {}) },
  { label: 'Last Appointment Cutoff', value: formatDisplayTime(config.time_settings?.last_appointment_time) },
  { label: 'Break Period', value: formatBreakPeriod(config.time_settings || {}) },
  { label: 'Slot Interval', value: config.time_settings?.slot_interval_minutes ? `${config.time_settings.slot_interval_minutes} minutes` : 'Not configured' },
  { label: 'Date Overrides', value: formatOverrideSummary(config.date_overrides || []) },
]);

const ConfigurationSummaryCard = ({ title, config, accent = 'slate' }) => {
  const summaryItems = buildConfigurationSummary(config);
  const accentStyles = accent === 'emerald'
    ? {
      container: 'border-emerald-200 bg-emerald-50/60',
      label: 'text-emerald-600',
      value: 'text-emerald-950',
    }
    : {
      container: 'border-slate-200 bg-slate-50',
      label: 'text-slate-400',
      value: 'text-slate-700',
    };

  return (
    <div className={`rounded-2xl border p-4 ${accentStyles.container}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${accentStyles.label}`}>{title}</p>
      <div className="mt-4 space-y-3">
        {summaryItems.map((item) => (
          <div key={`${title}-${item.label}`} className="rounded-xl bg-white/80 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
            <p className={`mt-1 text-sm font-medium leading-6 ${accentStyles.value}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const getViewedPublishedHistoryStorageKey = (branchUser) => {
  const branchId = branchUser?.branch_id || 'unknown-branch';
  const username = branchUser?.username || branchUser?.full_name || 'unknown-user';
  return `branchViewedPublishedHistory:${branchId}:${username}`;
};

const BranchSettings = () => {
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isBranchAdmin = branchUser?.role === 'branch_admin' || branchUser?.internal_role === 'branch_admin';
  const todayDate = useMemo(() => getUtc8TodayDate(), []);
  const viewedPublishedHistoryStorageKey = useMemo(() => getViewedPublishedHistoryStorageKey(branchUser), [branchUser]);

  const [schedule, setSchedule] = useState(null);
  const [publishedSchedule, setPublishedSchedule] = useState(null);
  const [systemSettings, setSystemSettings] = useState(null);
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
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaError, setMfaError] = useState('');
  const [settingUpMfa, setSettingUpMfa] = useState(false);
  const [systemSaving, setSystemSaving] = useState(false);
  const [viewedPublishedHistoryIds, setViewedPublishedHistoryIds] = useState(() => {
    try {
      const rawValue = window.localStorage.getItem(getViewedPublishedHistoryStorageKey(JSON.parse(localStorage.getItem('branchUser') || '{}')));
      const parsedValue = rawValue ? JSON.parse(rawValue) : [];
      return Array.isArray(parsedValue) ? parsedValue : [];
    } catch {
      return [];
    }
  });

  const fetchSettings = async () => {
    const [settingsResponse, historyResponse, systemSettingsResponse] = await Promise.all([
      branchSettingsAPI.getAppointmentSettings(),
      branchSettingsAPI.getAppointmentHistory({ page: 1, page_size: PAGE_SIZE }),
      branchSettingsAPI.getSystemSettings(),
    ]);
    setSchedule(settingsResponse.data?.draft);
    setPublishedSchedule(settingsResponse.data?.published);
    setSystemSettings(systemSettingsResponse.data);
    setHistoryState(historyResponse.data);
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
        if (currentIds.includes(entry.id)) {
          return currentIds;
        }
        const nextIds = [...currentIds, entry.id];
        window.localStorage.setItem(viewedPublishedHistoryStorageKey, JSON.stringify(nextIds));
        return nextIds;
      });
    }
    setSelectedHistoryEntry(entry);
    setShowHistoryModal(true);
  };

  const closeHistoryModal = () => {
    setSelectedHistoryEntry(null);
    setShowHistoryModal(false);
  };

  const handleDeleteHistoryEntry = (entry) => {
    setEntryToDelete(entry);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setEntryToDelete(null);
    setShowDeleteModal(false);
  };

  const confirmDeleteHistoryEntry = async () => {
    if (!entryToDelete) {
      return;
    }

    try {
      setDeletingHistoryId(entryToDelete.id);
      setError('');
      await branchSettingsAPI.deleteAppointmentHistoryEntry(entryToDelete.id);
      const nextPage = historyState.items.length === 1 && historyState.page > 1
        ? historyState.page - 1
        : historyState.page;
      await loadHistoryPage(nextPage);
      closeDeleteModal();
      if (selectedHistoryEntry?.id === entryToDelete.id) {
        closeHistoryModal();
      }
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
      date_overrides: current.date_overrides.map((entry, entryIndex) => (
        entryIndex === index ? { ...entry, [fieldName]: value } : entry
      )),
    }));
  };

  const addOverride = () => {
    setSchedule((current) => ({
      ...current,
      date_overrides: [...(current?.date_overrides || []), createEmptyOverride()],
    }));
  };

  const removeOverride = (index) => {
    setSchedule((current) => ({
      ...current,
      date_overrides: current.date_overrides.filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const buildPayload = () => ({
    ...schedule,
    reason: reason.trim() || null,
  });

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccessMessage('');
      const response = await branchSettingsAPI.saveAppointmentSettings(buildPayload());
      setSchedule(response.data.schedule?.draft);
      setPublishedSchedule(response.data.schedule?.published);
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
    try {
      setPublishing(true);
      setError('');
      setSuccessMessage('');
      const response = await branchSettingsAPI.publishAppointmentSettings(buildPayload());
      setSchedule(response.data.schedule?.draft);
      setPublishedSchedule(response.data.schedule?.published);
      setSuccessMessage(
        response.data.notice
          ? `Published successfully and posted to Policies & SOPs as "${response.data.notice.title}".`
          : 'Appointment schedule published successfully.'
      );
      if (response.data.notice) {
        window.dispatchEvent(new Event('branch-policy-updated'));
      }
      setReason('');
      await loadHistoryPage(1);
    } catch (publishError) {
      console.error('Failed to publish appointment settings:', publishError);
      setError(publishError.response?.data?.detail || 'Failed to publish appointment settings.');
    } finally {
      setPublishing(false);
    }
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
    availableDays: schedule?.weekly_schedule?.filter((day) => day.is_available).length || 0,
    overrides: schedule?.date_overrides?.length || 0,
    publishedOverrides: publishedSchedule?.date_overrides?.length || 0,
    lastPublished: historyState.items.find((item) => item.action === 'published')?.changed_at || null,
  }), [schedule, publishedSchedule, historyState.items]);
  const enabledPublicServices = useMemo(() => (
    systemSettings?.serviceOptions?.map((serviceName) => ({
      name: serviceName,
      enabled: Boolean(systemSettings?.queueEnabled) && (systemSettings?.enabledServices || []).includes(serviceName),
    })) || []
  ), [systemSettings]);
  const latestPublishedHistoryId = useMemo(
    () => historyState.items.find((item) => item.action === 'published')?.id || null,
    [historyState.items],
  );
  const highlightedPublishedHistoryId = useMemo(() => {
    if (!latestPublishedHistoryId || viewedPublishedHistoryIds.includes(latestPublishedHistoryId)) {
      return null;
    }
    return latestPublishedHistoryId;
  }, [latestPublishedHistoryId, viewedPublishedHistoryIds]);

  const updateBranchSystemSetting = (fieldName, value) => {
    setSystemSettings((current) => ({
      ...current,
      [fieldName]: value,
      ...(fieldName === 'queueEnabled' && value === false ? { enabledServices: [] } : {}),
    }));
  };

  const toggleBranchService = (serviceName) => {
    if (!isBranchAdmin || !systemSettings?.queueEnabled) {
      return;
    }

    setSystemSettings((current) => {
      const isEnabled = current.enabledServices.includes(serviceName);
      return {
        ...current,
        enabledServices: isEnabled
          ? current.enabledServices.filter((service) => service !== serviceName)
          : [...current.enabledServices, serviceName].sort(),
      };
    });
  };

  const handleSaveBranchSystemSettings = async () => {
    try {
      setSystemSaving(true);
      setError('');
      setSuccessMessage('');
      const response = await branchSettingsAPI.saveSystemSettings({
        queueEnabled: Boolean(systemSettings.queueEnabled),
        maxQueuePerBranch: Number(systemSettings.maxQueuePerBranch || 1),
        maxQueuePerWindow: Number(systemSettings.maxQueuePerWindow || 1),
        queueTimeSlot: Number(systemSettings.queueTimeSlot || 1),
        enabledServices: systemSettings.enabledServices || [],
        paymentGatewayEnabled: Boolean(systemSettings.paymentGatewayEnabled),
        receiptRequestEnabled: Boolean(systemSettings.receiptRequestEnabled),
        maintenanceMode: Boolean(systemSettings.maintenanceMode),
      });
      setSystemSettings(response.data?.settings || systemSettings);
      setSuccessMessage('Branch-only system settings saved successfully.');
    } catch (saveError) {
      console.error('Failed to save branch system settings:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to save branch-only system settings.');
    } finally {
      setSystemSaving(false);
    }
  };

  if (loading || !schedule || !systemSettings) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-gray-600">Loading branch settings...</p>
        </div>
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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Queue Status" value={systemSettings.queueEnabled ? 'Open' : 'Closed'} helper="Live queue registration availability for this branch." />
        <SummaryCard label="Open Weekdays" value={summary.availableDays} helper={getAvailableDaysLabel(schedule.weekly_schedule)} />
        <SummaryCard label="Draft Overrides" value={summary.overrides} helper="Current date onward only" />
        <SummaryCard label="Published Overrides" value={summary.publishedOverrides} helper="Active branch exceptions" />
        <SummaryCard label="Last Published" value={summary.lastPublished ? formatUtc8DateTime(summary.lastPublished) : 'Not yet'} helper="Most recent published schedule" />
      </section>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-900 shadow-sm">
        <p className="font-semibold">Branch-only system controls are now available here</p>
        <p className="mt-1 text-sm">
          Queue status, queue operations, services, and operational defaults below now save for this branch only and are the same controls followed by this branch&apos;s staff accounts.
        </p>
      </div>

      {!isBranchAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
          <p className="font-semibold">View-only access</p>
          <p className="mt-1 text-sm">Only Branch Admin accounts can save or publish appointment scheduling changes.</p>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-green-800 shadow-sm">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 shadow-sm">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Configuration Group</p>
              <h2 className="mt-2 text-xl font-bold text-primary">Queue Operations</h2>
              <p className="mt-2 text-sm text-gray-500">Shared queue controls from Main Admin that directly affect branch admin and branch staff queue workflows.</p>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">Queue System Availability</p>
                    <p className="mt-1 text-sm text-slate-500">Controls whether the public can register for queue services in this branch.</p>
                  </div>
                  <label className={`inline-flex min-w-[132px] items-center justify-between rounded-full border px-4 py-3 text-sm font-semibold ${systemSettings.queueEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}>
                    <span>{systemSettings.queueEnabled ? 'Enabled' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(systemSettings.queueEnabled)}
                      disabled={!isBranchAdmin}
                      onChange={(event) => updateBranchSystemSetting('queueEnabled', event.target.checked)}
                      className="h-5 w-5 accent-emerald-500"
                    />
                  </label>
                </div>
              </div>
              {[
                ['maxQueuePerBranch', 'Maximum Queue Per Branch', 'Caps the number of active waiting and serving queue entries per branch.'],
                ['maxQueuePerWindow', 'Maximum Queue Per Window', 'Caps the number of active queue entries allowed for each staff service window before that window automatically closes to new queue registrations.'],
                ['queueTimeSlot', 'Queue Time Slot', 'Default queue timing in minutes used for branch wait estimates and fallback processing time.'],
              ].map(([fieldName, label, description]) => (
                <div key={fieldName} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{label}</p>
                      <p className="mt-1 text-sm text-slate-500">{description}</p>
                    </div>
                    <div className="w-full rounded-2xl border border-slate-200 bg-white p-2 lg:max-w-xs">
                      <input
                        type="number"
                        min="1"
                        value={systemSettings[fieldName]}
                        disabled={!isBranchAdmin}
                        onChange={(event) => updateBranchSystemSetting(fieldName, Number(event.target.value))}
                        className="w-full rounded-xl border-0 bg-transparent px-3 py-2 text-sm text-gray-700 outline-none focus:ring-0 disabled:opacity-70"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Configuration Group</p>
              <h2 className="mt-2 text-xl font-bold text-primary">Services</h2>
              <p className="mt-2 text-sm text-gray-500">Shared public-service availability from Main Admin. These settings also determine which branch staff services stay active in supported workflows.</p>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-4">
                  <p className="font-semibold text-slate-800">Enabled Public Services</p>
                  <p className="text-sm text-slate-500">Service names available for public queueing and branch-facing service listings.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {enabledPublicServices.map((service) => (
                    <div
                      key={service.name}
                      onClick={() => toggleBranchService(service.name)}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                        service.enabled
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200 bg-white'
                      } ${isBranchAdmin && systemSettings.queueEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'}`}
                    >
                      <span className="text-sm font-medium text-slate-700">{service.name}</span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${service.enabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                        {service.enabled ? 'On' : 'Off'}
                      </span>
                    </div>
                  ))}
                </div>
                {!systemSettings.queueEnabled ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Services are automatically turned off for this branch while Queue System Availability is disabled.
                  </div>
                ) : null}
              </div>
              {[
                ['paymentGatewayEnabled', 'Online Payment Gateway Availability', 'Controls whether online tax payments can be started from this branch context.'],
                ['receiptRequestEnabled', 'Request Receipt Copy Availability', 'Controls whether taxpayers can submit receipt copy requests for this branch.'],
              ].map(([fieldName, label, description]) => (
                <div key={fieldName} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{label}</p>
                      <p className="mt-1 text-sm text-slate-500">{description}</p>
                    </div>
                    <label className={`inline-flex min-w-[132px] items-center justify-between rounded-full border px-4 py-3 text-sm font-semibold ${systemSettings[fieldName] ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}>
                      <span>{systemSettings[fieldName] ? 'Enabled' : 'Disabled'}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(systemSettings[fieldName])}
                        disabled={!isBranchAdmin}
                        onChange={(event) => updateBranchSystemSetting(fieldName, event.target.checked)}
                        className="h-5 w-5 accent-emerald-500"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Configuration Group</p>
              <h2 className="mt-2 text-xl font-bold text-primary">Operational Defaults</h2>
              <p className="mt-2 text-sm text-gray-500">System-wide operational switches inherited from Main Admin and applied to branch-facing workflows.</p>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">Maintenance Mode</p>
                    <p className="mt-1 text-sm text-slate-500">Temporarily disables public-facing operational workflows for this branch while maintenance is ongoing.</p>
                  </div>
                  <label className={`inline-flex min-w-[132px] items-center justify-between rounded-full border px-4 py-3 text-sm font-semibold ${systemSettings.maintenanceMode ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    <span>{systemSettings.maintenanceMode ? 'Enabled' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(systemSettings.maintenanceMode)}
                      disabled={!isBranchAdmin}
                      onChange={(event) => updateBranchSystemSetting('maintenanceMode', event.target.checked)}
                      className="h-5 w-5 accent-emerald-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Weekly Availability</p>
              <h2 className="mt-2 text-xl font-bold text-primary">Appointment Days</h2>
              <p className="mt-2 text-sm text-gray-500">Enable only the weekdays when this branch should accept appointment queue bookings.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              {schedule.weekly_schedule.map((entry) => (
                <label key={entry.day} className={`flex items-center justify-between rounded-2xl border px-5 py-4 transition ${entry.is_available ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div>
                    <p className="font-semibold text-slate-800">{entry.day}</p>
                    <p className="mt-1 text-sm text-slate-500">{entry.is_available ? 'Appointments accepted' : 'Closed for appointments'}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={entry.is_available}
                    disabled={!isBranchAdmin}
                    onChange={(event) => updateWeeklyDay(entry.day, event.target.checked)}
                    className="h-5 w-5 accent-emerald-500"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Time Availability</p>
              <h2 className="mt-2 text-xl font-bold text-primary">Operating Hours And Cutoff</h2>
              <p className="mt-2 text-sm text-gray-500">Set the live appointment window, optional lunch break, and the last time a citizen can still book a slot.</p>
            </div>
            <div className="grid grid-cols-1 gap-5 p-6 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Opening Time</label>
                <input type="time" value={schedule.time_settings.opening_time} disabled={!isBranchAdmin} onChange={(event) => updateTimeSetting('opening_time', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Closing Time</label>
                <input type="time" value={schedule.time_settings.closing_time} disabled={!isBranchAdmin} onChange={(event) => updateTimeSetting('closing_time', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Last Appointment Cutoff</label>
                <input type="time" value={schedule.time_settings.last_appointment_time} disabled={!isBranchAdmin} onChange={(event) => updateTimeSetting('last_appointment_time', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Lunch Break Start</label>
                <input type="time" value={schedule.time_settings.break_start || ''} disabled={!isBranchAdmin} onChange={(event) => updateTimeSetting('break_start', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Lunch Break End</label>
                <input type="time" value={schedule.time_settings.break_end || ''} disabled={!isBranchAdmin} onChange={(event) => updateTimeSetting('break_end', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Slot Interval (Minutes)</label>
                <input type="number" min="5" max="120" value={schedule.time_settings.slot_interval_minutes} disabled={!isBranchAdmin} onChange={(event) => updateTimeSetting('slot_interval_minutes', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Date Availability</p>
                  <h2 className="mt-2 text-xl font-bold text-primary">Calendar Overrides</h2>
                  <p className="mt-2 text-sm text-gray-500">Use date-specific overrides to mark holidays, closures, special operations days, or temporary openings.</p>
                </div>
                {isBranchAdmin && (
                  <button onClick={addOverride} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary">
                    Add Override
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4 p-6">
              {schedule.date_overrides.length ? schedule.date_overrides.map((override, index) => (
                <div key={`${override.date || 'new'}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[180px_230px_1fr_auto]">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Date</label>
                      <input type="date" min={todayDate} value={override.date} disabled={!isBranchAdmin} onChange={(event) => updateOverride(index, 'date', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Status</label>
                      <select value={override.status} disabled={!isBranchAdmin} onChange={(event) => updateOverride(index, 'status', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm">
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Label / Event Name</label>
                      <input type="text" value={override.label || ''} disabled={!isBranchAdmin} onChange={(event) => updateOverride(index, 'label', event.target.value)} placeholder="Example: Christmas Day" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                    </div>
                    {isBranchAdmin && (
                      <div className="flex items-end">
                        <button onClick={() => removeOverride(index)} className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700">
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Notes / Remarks</label>
                    <textarea value={override.notes || ''} disabled={!isBranchAdmin} onChange={(event) => updateOverride(index, 'notes', event.target.value)} rows="3" placeholder="Add any details staff should know about this schedule exception." className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-500">
                  No date overrides added yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Branch Controls</p>
            <h2 className="mt-2 text-xl font-bold text-primary">Save Branch System Settings</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              These queue, service, and operational settings apply only to this branch and are the same controls followed by this branch&apos;s staff accounts.
            </p>
            <button
              onClick={handleSaveBranchSystemSettings}
              disabled={!isBranchAdmin || systemSaving}
              className="mt-5 w-full rounded-2xl bg-primary px-5 py-4 font-semibold text-white transition duration-300 hover:bg-secondary disabled:opacity-60"
            >
              {systemSaving ? 'Saving Branch System Settings...' : 'Save Branch System Settings'}
            </button>
            {!isBranchAdmin ? (
              <p className="mt-3 text-sm text-slate-500">Only Branch Admin accounts can save branch-only system settings.</p>
            ) : null}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Account Protection</p>
            <h2 className="mt-2 text-xl font-bold text-primary">Branch Admin Security</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Reset and re-enroll Microsoft Authenticator for this branch administrator account whenever the device or authentication setup changes.
            </p>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-semibold text-amber-900">Microsoft Authenticator</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  Resetting MFA issues a fresh QR code and manual key so the branch admin can securely reconfigure their authentication method.
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetMfa}
                disabled={!isBranchAdmin || settingUpMfa}
                className="w-full rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {settingUpMfa ? 'Preparing MFA...' : 'Reset MFA'}
              </button>

              {!isBranchAdmin ? (
                <p className="text-sm text-slate-500">Only Branch Admin accounts can reset and re-enroll MFA.</p>
              ) : null}

              {mfaError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                  <p className="font-semibold">{mfaError}</p>
                </div>
              ) : null}

              {mfaSetupData ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                  <p className="mb-2 font-semibold text-emerald-900">Scan this QR code in Microsoft Authenticator</p>
                  <p className="mb-4 text-sm text-emerald-800">
                    Use this new enrollment to complete your MFA reset and secure future branch logins.
                  </p>
                  <div className="mb-4 flex justify-center">
                    <img
                      src={mfaSetupData.qr_code}
                      alt="Branch admin MFA QR code"
                      className="h-56 w-56 rounded-xl border-4 border-white shadow-lg"
                    />
                  </div>
                  <p className="mb-2 text-sm text-emerald-900">Manual entry key</p>
                  <code className="block break-all rounded-lg border border-emerald-200 bg-white p-3 text-sm">
                    {mfaSetupData.manual_entry_key}
                  </code>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Publish Control</p>
            <h2 className="mt-2 text-xl font-bold text-primary">Save And Publish</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Publishing pushes the approved schedule live to the public appointment queue and records a policy update for branch staff.
            </p>

            <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Draft Effective Date</p>
                <input type="date" min={todayDate} value={schedule.effective_date} disabled={!isBranchAdmin} onChange={(event) => setSchedule((current) => ({ ...current, effective_date: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Current Draft Window</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">{formatTimeWindow(schedule.time_settings)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Published Window</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">{formatTimeWindow(publishedSchedule?.time_settings || {})}</p>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Reason / Change Note</label>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows="4" disabled={!isBranchAdmin} placeholder="Optional explanation for the schedule update" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:opacity-70" />
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <button onClick={handlePublish} disabled={!isBranchAdmin || publishing} className="w-full rounded-2xl bg-primary px-5 py-4 font-semibold text-white transition hover:bg-secondary disabled:opacity-60">
                {publishing ? 'Publishing Schedule...' : 'Save and Publish Configuration'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Published Snapshot</p>
            <h2 className="mt-2 text-xl font-bold text-primary">Live Appointment Schedule</h2>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Effective Date</p>
                <p className="mt-2 text-sm font-medium text-slate-700">{publishedSchedule?.effective_date || 'Not published'}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Available Days</p>
                <p className="mt-2 text-sm font-medium text-slate-700">{getAvailableDaysLabel(publishedSchedule?.weekly_schedule || [])}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Time Window</p>
                <p className="mt-2 text-sm font-medium text-slate-700">{formatTimeWindow(publishedSchedule?.time_settings || {})}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Traceability</p>
              <h2 className="mt-2 text-2xl font-bold text-primary">Configuration Audit History</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Review every saved or published branch schedule change, including previous values, updated values, who changed them, and when they took effect.
              </p>
            </div>
            <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              {historyState.total} record{historyState.total === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          {historyState.items.length ? historyState.items.map((entry) => (
            <div key={entry.id} className={`rounded-2xl border p-5 transition hover:border-slate-300 ${entry.id === highlightedPublishedHistoryId && entry.action === 'published' ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${entry.action === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                      {entry.action === 'published' ? 'Published' : 'Saved Draft'}
                    </span>
                    {entry.id === highlightedPublishedHistoryId && entry.action === 'published' ? (
                      <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                        Recently Published
                      </span>
                    ) : null}
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                      Effective {entry.effective_date}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-primary">
                    {entry.action === 'published' ? 'Published Branch Schedule' : 'Saved Draft Schedule'}
                  </h3>
                  <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Previous Time Window</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{formatTimeWindow(entry.previous_config?.time_settings || {})}</p>
                    </div>
                    <div className="justify-self-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                      to
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">New Time Window</p>
                      <p className="mt-2 text-sm font-medium text-emerald-900">{formatTimeWindow(entry.new_config?.time_settings || {})}</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Preview Summary</p>
                      <span className="text-xs text-slate-400">Shortened for readability</span>
                    </div>
                    <ul className="mt-3 space-y-2 text-sm text-slate-700">
                      {entry.change_summary?.length ? entry.change_summary.slice(0, 3).map((line, index) => (
                        <li key={`${entry.id}-${index}`}>- {line}</li>
                      )) : <li>- No change summary available.</li>}
                    </ul>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-3 lg:w-[240px]">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Changed By</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">{entry.changed_by}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Changed At</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">{entry.changed_at ? formatUtc8DateTime(entry.changed_at) : 'N/A'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Reason</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">{entry.reason || 'No reason provided.'}</p>
                  </div>
                  {isBranchAdmin ? (
                    <>
                      <button
                        onClick={() => handleViewHistoryEntry(entry)}
                        className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-secondary"
                      >
                        Preview Details
                      </button>
                      <button
                        onClick={() => handleDeleteHistoryEntry(entry)}
                        disabled={deletingHistoryId === entry.id}
                        className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                      >
                        {deletingHistoryId === entry.id ? 'Deleting...' : 'Delete Record'}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-500">
              No appointment schedule history yet.
            </div>
          )}
        </div>

        {historyState.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Showing page {historyState.page} of {historyState.total_pages}</p>
            <div className="flex gap-3">
              <button onClick={() => loadHistoryPage(historyState.page - 1)} disabled={historyState.page <= 1} className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-60">
                Previous
              </button>
              <button onClick={() => loadHistoryPage(historyState.page + 1)} disabled={historyState.page >= historyState.total_pages} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-60">
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {showHistoryModal && selectedHistoryEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-6 md:px-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${selectedHistoryEntry.action === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                      {selectedHistoryEntry.action === 'published' ? 'Published' : 'Saved Draft'}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Audit History Detail</span>
                  </div>
                  <h3 className="mt-4 text-2xl font-bold text-primary md:text-3xl">
                    {selectedHistoryEntry.action === 'published' ? 'Published Configuration' : 'Saved Draft'}
                  </h3>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <p className="font-semibold text-primary">Changed By</p>
                  <p className="mt-1">{selectedHistoryEntry.changed_by}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 px-6 py-6 md:px-8 lg:grid-cols-[1.45fr_0.95fr]">
              <section className="space-y-6">
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-5 md:p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">What Changed</p>
                  <ul className="mt-4 space-y-2 text-sm leading-7 text-slate-700">
                    {selectedHistoryEntry.change_summary?.length ? selectedHistoryEntry.change_summary.map((line, index) => (
                      <li key={`${selectedHistoryEntry.id}-modal-${index}`}>- {line}</li>
                    )) : <li>- No change summary available.</li>}
                  </ul>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <ConfigurationSummaryCard
                    title="Previous Configuration"
                    config={selectedHistoryEntry.previous_config || {}}
                  />
                  <ConfigurationSummaryCard
                    title="Updated Configuration"
                    config={selectedHistoryEntry.new_config || {}}
                    accent="emerald"
                  />
                </div>
              </section>

              <aside className="space-y-4">
                <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Publication Details</p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Effective Date</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{selectedHistoryEntry.effective_date}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Changed At</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{selectedHistoryEntry.changed_at ? formatUtc8DateTime(selectedHistoryEntry.changed_at) : 'N/A'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Reason</p>
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm font-medium leading-6 text-slate-700">{selectedHistoryEntry.reason || 'No reason provided.'}</p>
                  </div>
                </div>
              </aside>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 md:flex-row md:justify-end md:px-8">
              <button
                onClick={closeHistoryModal}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition duration-300 hover:bg-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z"></path>
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">Confirm Deletion</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">Delete this audit history entry?</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  This will permanently remove the selected branch configuration audit record.
                </p>
              </div>
            </div>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Changed At</p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {entryToDelete.changed_at ? formatUtc8DateTime(entryToDelete.changed_at) : 'N/A'}
              </p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
              <button
                onClick={closeDeleteModal}
                disabled={deletingHistoryId !== null}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteHistoryEntry}
                disabled={deletingHistoryId !== null}
                className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-70"
              >
                {deletingHistoryId !== null ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchSettings;
