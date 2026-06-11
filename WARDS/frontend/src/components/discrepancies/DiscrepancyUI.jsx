export const discrepancyStatusStyles = {
  'Pending Review': 'bg-amber-100 text-amber-800 border border-amber-200',
  'Under Review': 'bg-blue-100 text-blue-800 border border-blue-200',
  Verified: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  Fixed: 'bg-teal-100 text-teal-800 border border-teal-200',
  Responded: 'bg-violet-100 text-violet-800 border border-violet-200',
  Solved: 'bg-green-100 text-green-800 border border-green-200',
  Rejected: 'bg-rose-100 text-rose-800 border border-rose-200',
};

const actorToneStyles = {
  'Super Admin': {
    badge: 'border border-[#0b2545]/20 bg-[#0b2545]/10 text-[#0b2545]',
    card: 'border-[#0b2545]/15 bg-[#f4f8fc]',
    rail: 'bg-primary',
  },
  'Main Admin': {
    badge: 'border border-[#174b73]/20 bg-[#174b73]/10 text-[#0b2545]',
    card: 'border-[#174b73]/15 bg-[#f6f9fc]',
    rail: 'bg-secondary',
  },
  'Branch Admin': {
    badge: 'border border-slate-300 bg-white text-[#0b2545]',
    card: 'border-slate-200 bg-white',
    rail: 'bg-slate-500',
  },
  'Branch Staff': {
    badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    card: 'border-slate-200 bg-slate-50/90',
    rail: 'bg-slate-400',
  },
  System: {
    badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    card: 'border-slate-200 bg-slate-50/90',
    rail: 'bg-slate-400',
  },
};

export const discrepancyModalShellClass = 'flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl';
export const discrepancyModalHeaderClass = 'border-b border-[#0b2545]/15 bg-primary px-6 py-5 sm:px-8';
export const discrepancySectionCardClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';

export const formatActorRole = (role) => {
  const normalized = (role || '').trim().toLowerCase();
  if (normalized === 'superadmin') return 'Super Admin';
  if (normalized === 'main_admin') return 'Main Admin';
  if (normalized === 'branch_admin') return 'Branch Admin';
  if (normalized === 'branch_staff') return 'Branch Staff';
  return role || 'System';
};

export const getActorTone = (role) => actorToneStyles[role] || actorToneStyles.System;

export const DiscrepancyStatusBadge = ({ status, className = '' }) => (
  <span
    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${discrepancyStatusStyles[status] || 'border border-slate-200 bg-slate-100 text-slate-700'} ${className}`.trim()}
  >
    {status || 'Unknown'}
  </span>
);

export const DiscrepancyInfoCard = ({ label, value, helper, tone = 'slate', children }) => {
  const toneClasses = {
    blue: 'border-[#0b2545]/15 bg-[#f4f8fc]',
    emerald: 'border-[#174b73]/15 bg-[#f7fafc]',
    amber: 'border-slate-200 bg-slate-50/90',
    violet: 'border-[#0b2545]/10 bg-[#f8fafc]',
    slate: 'border-slate-200 bg-slate-50/90',
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
      {helper ? <p className="mt-2 text-xs leading-5 text-slate-500">{helper}</p> : null}
      {children}
    </div>
  );
};

export const DiscrepancySection = ({ title, description, action, children, className = '' }) => (
  <section className={`${discrepancySectionCardClass} ${className}`.trim()}>
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    <div className="mt-5">{children}</div>
  </section>
);

export const DiscrepancyTimelineEntry = ({ entry, formatDateTime }) => {
  const displayRole = entry.sender_display_role || formatActorRole(entry.sender_role);
  const displayName = entry.sender_display_name || entry.sender_name || 'System';
  const tone = getActorTone(displayRole);

  return (
    <div className={`relative rounded-2xl border p-5 shadow-sm ${tone.card}`}>
      <span className={`absolute left-0 top-5 h-12 w-1 rounded-r-full ${tone.rail}`}></span>
      <div className="pl-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">{displayName}</p>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}>
                {displayRole}
              </span>
              {entry.label ? (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  {entry.label}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-medium text-slate-700">{entry.message || 'Status updated without additional notes.'}</p>
          </div>
          <div className="space-y-2 md:text-right">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              {formatDateTime ? formatDateTime(entry.created_at) : entry.created_at || 'No timestamp'}
            </p>
            {entry.status ? <DiscrepancyStatusBadge status={entry.status} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
};
