import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';

const PAYMENT_TIME_ZONE = 'Asia/Manila';
const TRANSACTIONS_PER_PAGE = 10;
const TREND_DAYS = 7;

const createEmptyFilters = () => ({
  search: '',
  status: 'all',
  paymentMethod: 'all',
  taxType: 'all',
  dateFrom: '',
  dateTo: '',
  reference: '',
  citizenName: '',
  tin: '',
  email: '',
});

const parsePaymentDate = (value) => {
  if (!value) return null;
  const normalizedValue =
    typeof value === 'string' && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const parsedDate = new Date(normalizedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const formatPaymentDate = (value, options) => {
  const parsedDate = parsePaymentDate(value);
  if (!parsedDate) return 'N/A';
  return parsedDate.toLocaleString('en-PH', { timeZone: PAYMENT_TIME_ZONE, ...options });
};

const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildApiAssetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = api.defaults.baseURL || 'http://localhost:8000/api';
  const apiOrigin = baseUrl.replace(/\/api\/?$/, '');
  return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
};

const getPaymentDayKey = (value) => formatPaymentDate(value, { year: 'numeric', month: '2-digit', day: '2-digit' });

const normalizePaymentMethodLabel = (paymentMethod) => {
  const normalized = (paymentMethod || 'Unspecified').replace(/_/g, ' ').trim();
  if (!normalized) return 'Unspecified';
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const normalizeStatus = (status) => {
  const normalized = (status || '').toString().trim().toLowerCase();
  if ([
    'confirmed',
    'verified',
    'payment_verified',
    'paid',
    'succeeded',
    'successful',
    'success',
    'or_generated',
    'official_receipt_generated',
    'receipt_generated',
    'completed',
  ].includes(normalized)) {
    return 'confirmed';
  }
  if (normalized === 'expired') return 'expired';
  if (['failed', 'declined', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
  return 'pending';
};

const isProcessingPayment = (payment) => normalizeStatus(payment?.status) === 'pending';

const getPaymentKey = (payment) =>
  payment.paymongo_payment_id ||
  payment.paymongo_payment_intent_id ||
  payment.paymongo_checkout_session_id ||
  payment.ref_number ||
  payment.transaction_id ||
  `payment-${payment.id}`;

const getPaymentPreferenceScore = (payment) => {
  const status = normalizeStatus(payment.status);
  const statusScore = {
    confirmed: 3,
    pending: 2,
    failed: 1,
    expired: 0,
  }[status] ?? 0;
  const timestamp = parsePaymentDate(payment.verified_at || payment.created_at)?.getTime() || 0;
  return (statusScore * 1_000_000_000_000) + timestamp;
};

const STATUS_CONFIG = {
  confirmed: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Verified' },
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pending' },
  failed: { bg: 'bg-rose-100', text: 'text-rose-800', label: 'Failed' },
  expired: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Expired' },
};

const SectionCard = ({ title, subtitle, action, children }) => (
  <section className="overflow-hidden rounded-[28px] border border-slate-300/90 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.08)]">
    <div className="border-b border-slate-200 bg-slate-50/80 px-6 py-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
    </div>
    <div className="px-6 py-6">{children}</div>
  </section>
);

const DashboardIcon = ({ type }) => {
  const commonProps = { className: 'h-5 w-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' };

  if (type === 'wallet') {
    return (
      <svg {...commonProps}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7.5A2.5 2.5 0 015.5 5H18a2 2 0 012 2v1H7A2.5 2.5 0 004.5 10.5v5A2.5 2.5 0 007 18h13v1a2 2 0 01-2 2H5.5A2.5 2.5 0 013 18.5v-11z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 8H7a2 2 0 00-2 2v5a2 2 0 002 2h12a1 1 0 001-1V9a1 1 0 00-1-1z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 12h.01" />
      </svg>
    );
  }

  if (type === 'check') {
    return (
      <svg {...commonProps}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12.75l2.25 2.25L15 9.75" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  if (type === 'clock') {
    return (
      <svg {...commonProps}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6v6l4 2" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  if (type === 'alert') {
    return (
      <svg {...commonProps}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v3.75m0 3h.008v.008H12v-.008z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.29 3.86L1.82 18a2 2 0 001.72 3h16.92a2 2 0 001.72-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    );
  }

  if (type === 'trend') {
    return (
      <svg {...commonProps}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.5-4.5 3.5 3.5L20 7" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 7h5v5" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
};

const KpiCard = ({ icon, label, value, helper }) => (
  <div className="relative overflow-hidden rounded-[28px] border border-slate-300/90 bg-white p-6 shadow-[0_12px_28px_rgba(15,23,42,0.07)]">
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0f2f5f] via-[#19498d] to-[#1e5bb8]" />
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
        <p className="mt-4 text-3xl font-bold text-slate-900">{value}</p>
        <p className="mt-2 text-sm text-slate-500">{helper}</p>
      </div>
      <div className="rounded-2xl bg-[#0f2f5f] p-3 text-white shadow-lg shadow-blue-900/25 ring-1 ring-white/10">
        <DashboardIcon type={icon} />
      </div>
    </div>
  </div>
);

const StatusBadge = ({ status }) => {
  const normalized = normalizeStatus(status);
  const config = STATUS_CONFIG[normalized] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
};

const MiniBarChart = ({ items }) => {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
        No payment method data is available for the current filters.
      </div>
    );
  }

  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-semibold text-slate-800">{item.label}</p>
              <p className="text-xs text-slate-500">{item.helper}</p>
            </div>
            <p className="font-bold text-[#0f2f5f]">{item.count}</p>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-[#0f2f5f] to-[#2f6cc4]"
              style={{ width: `${Math.max((item.count / max) * 100, 8)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const DoughnutStatusChart = ({ values }) => {
  const total = values.pending + values.confirmed + values.failed;
  const pending = total ? (values.pending / total) * 100 : 0;
  const confirmed = total ? (values.confirmed / total) * 100 : 0;
  const failed = total ? (values.failed / total) * 100 : 0;
  const chartStyle = {
    background: `conic-gradient(#10b981 0 ${confirmed}%, #f59e0b ${confirmed}% ${confirmed + pending}%, #ef4444 ${confirmed + pending}% 100%)`,
  };

  const legendItems = [
    { label: 'Verified', value: values.confirmed, color: 'bg-emerald-500' },
    { label: 'Pending', value: values.pending, color: 'bg-amber-500' },
    { label: 'Failed / Declined', value: values.failed, color: 'bg-rose-500' },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px,1fr] lg:items-center">
      <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-full p-5" style={chartStyle}>
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Transactions</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
        </div>
      </div>
      <div className="space-y-3">
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${item.color}`} />
              <p className="text-sm font-semibold text-slate-800">{item.label}</p>
            </div>
            <p className="text-sm font-bold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const TrendChart = ({ title, subtitle, points, color, valueKey }) => {
  if (!points.length) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          No trend data is available for the current filters.
        </div>
      </div>
    );
  }

  const width = 560;
  const height = 220;
  const padding = 28;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(1, ...points.map((point) => Number(point[valueKey] || 0)));

  const path = points
    .map((point, index) => {
      const x = padding + (chartWidth * index) / Math.max(points.length - 1, 1);
      const y = height - padding - (Number(point[valueKey] || 0) / maxValue) * chartHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + ratio * chartHeight;
          return <line key={ratio} x1={padding} x2={width - padding} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
        })}
        <path d={path} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const x = padding + (chartWidth * index) / Math.max(points.length - 1, 1);
          const y = height - padding - (Number(point[valueKey] || 0) / maxValue) * chartHeight;
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="4.5" fill={color} />;
        })}
      </svg>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {points.slice(-4).map((point) => (
          <div key={point.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">{point.label}</p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              {valueKey === 'amount' ? formatCurrency(point.amount) : point.count}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ConfirmationModal = ({
  title,
  message,
  details,
  warning,
  cancelLabel,
  confirmLabel,
  confirmClassName,
  onCancel,
  onConfirm,
  loading,
  iconType,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
      <div className="p-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-[#0f2f5f]">
          <DashboardIcon type={iconType} />
        </div>
        <h3 className="text-center text-xl font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-center text-sm leading-6 text-slate-500">{message}</p>
        <div className="mt-6 space-y-2 rounded-2xl bg-slate-50 p-4">
          {details.map((detail) => (
            <div key={detail.label} className="flex items-start justify-between gap-4 text-sm">
              <span className="text-slate-500">{detail.label}</span>
              <span className="text-right font-semibold text-slate-900">{detail.value}</span>
            </div>
          ))}
        </div>
        {warning ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {warning}
          </div>
        ) : null}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-2xl bg-slate-200 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 rounded-2xl px-4 py-3 font-semibold text-white transition disabled:opacity-50 ${confirmClassName}`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  </div>
);

const PaymentManagement = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftFilters, setDraftFilters] = useState(() => createEmptyFilters());
  const [appliedFilters, setAppliedFilters] = useState(() => createEmptyFilters());
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [paymentToDecline, setPaymentToDecline] = useState(null);
  const [declining, setDeclining] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [paymentToVerify, setPaymentToVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchPayments();
    const interval = setInterval(fetchPayments, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchPayments = async () => {
    try {
      const response = await api.get('/branch/payments');
      const uniquePayments = new Map();

      (response.data || []).forEach((payment) => {
        const key = getPaymentKey(payment);
        const existing = uniquePayments.get(key);
        if (!existing || getPaymentPreferenceScore(payment) > getPaymentPreferenceScore(existing)) {
          uniquePayments.set(key, payment);
        }
      });

      const normalizedPayments = Array.from(uniquePayments.values()).sort((left, right) => {
        const leftTime = parsePaymentDate(left.created_at)?.getTime() || 0;
        const rightTime = parsePaymentDate(right.created_at)?.getTime() || 0;
        return rightTime - leftTime;
      });

      setPayments(normalizedPayments);
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateDraftFilter = (field, value) => {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  };

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const resetFilters = () => {
    setDraftFilters(createEmptyFilters());
    setAppliedFilters(createEmptyFilters());
  };

  const handleVerifyClick = (payment) => {
    if (!isProcessingPayment(payment)) {
      return;
    }
    setPaymentToVerify(payment);
    setShowVerifyModal(true);
  };

  const handleVerifyConfirm = async () => {
    if (!paymentToVerify) return;

    setVerifying(true);
    try {
      await api.put(`/branch/payments/${paymentToVerify.id}/verify`);
      setShowVerifyModal(false);
      setPaymentToVerify(null);
      alert('Payment verified successfully');
      fetchPayments();
    } catch (error) {
      console.error('Failed to verify payment:', error);
      alert(`Failed to verify payment: ${error.response?.data?.detail || error.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyCancel = () => {
    setShowVerifyModal(false);
    setPaymentToVerify(null);
  };

  const handleDeleteClick = (payment) => {
    setPaymentToDelete(payment);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!paymentToDelete) return;

    setDeleting(true);
    try {
      await api.delete(`/branch/payments/${paymentToDelete.id}`);
      setShowDeleteModal(false);
      setPaymentToDelete(null);
      fetchPayments();
    } catch (error) {
      console.error('Failed to delete payment:', error);
      alert(`Failed to delete payment: ${error.response?.data?.detail || error.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setPaymentToDelete(null);
  };

  const handleDeclineClick = (payment) => {
    setPaymentToDecline(payment);
    setShowDeclineModal(true);
  };

  const handleDeclineConfirm = async () => {
    if (!paymentToDecline) return;

    setDeclining(true);
    try {
      await api.put(`/branch/payments/${paymentToDecline.id}/decline`);
      setShowDeclineModal(false);
      setPaymentToDecline(null);
      fetchPayments();
    } catch (error) {
      console.error('Failed to decline payment:', error);
      alert(`Failed to decline payment: ${error.response?.data?.detail || error.message}`);
    } finally {
      setDeclining(false);
    }
  };

  const handleDeclineCancel = () => {
    setShowDeclineModal(false);
    setPaymentToDecline(null);
  };

  const handleViewDetails = (payment) => {
    setSelectedPayment(payment);
    setShowDetailModal(true);
  };

  const paymentMethodOptions = useMemo(() => {
    const methods = Array.from(new Set(payments.map((payment) => normalizePaymentMethodLabel(payment.payment_method))));
    return methods.sort((left, right) => left.localeCompare(right));
  }, [payments]);

  const taxTypeOptions = useMemo(() => {
    const taxTypes = Array.from(new Set(payments.map((payment) => payment.tax_type).filter(Boolean)));
    return taxTypes.sort((left, right) => left.localeCompare(right));
  }, [payments]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => {
      const status = normalizeStatus(payment.status);
      const paymentMethod = normalizePaymentMethodLabel(payment.payment_method);
      const createdAt = parsePaymentDate(payment.created_at);
      const normalizedSearch = appliedFilters.search.trim().toLowerCase();

      if (appliedFilters.status !== 'all' && status !== appliedFilters.status) {
        return false;
      }
      if (appliedFilters.paymentMethod !== 'all' && paymentMethod !== appliedFilters.paymentMethod) {
        return false;
      }
      if (appliedFilters.taxType !== 'all' && payment.tax_type !== appliedFilters.taxType) {
        return false;
      }
      if (appliedFilters.dateFrom) {
        const rangeStart = new Date(`${appliedFilters.dateFrom}T00:00:00`);
        if (!createdAt || createdAt < rangeStart) return false;
      }
      if (appliedFilters.dateTo) {
        const rangeEnd = new Date(`${appliedFilters.dateTo}T23:59:59.999`);
        if (!createdAt || createdAt > rangeEnd) return false;
      }
      if (appliedFilters.reference && !String(payment.ref_number || '').toLowerCase().includes(appliedFilters.reference.toLowerCase())) {
        return false;
      }
      if (appliedFilters.citizenName && !String(payment.taxpayer_name || '').toLowerCase().includes(appliedFilters.citizenName.toLowerCase())) {
        return false;
      }
      if (appliedFilters.tin && !String(payment.tin || '').toLowerCase().includes(appliedFilters.tin.toLowerCase())) {
        return false;
      }
      if (appliedFilters.email && !String(payment.email || '').toLowerCase().includes(appliedFilters.email.toLowerCase())) {
        return false;
      }

      if (normalizedSearch) {
        const searchableFields = [
          payment.ref_number,
          payment.transaction_id,
          payment.taxpayer_name,
          payment.tin,
          payment.email,
          payment.tax_type,
          payment.branch,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        if (!searchableFields.some((value) => value.includes(normalizedSearch))) {
          return false;
        }
      }

      return true;
    });
  }, [payments, appliedFilters]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / TRANSACTIONS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedPayments = filteredPayments.slice(
    (safeCurrentPage - 1) * TRANSACTIONS_PER_PAGE,
    safeCurrentPage * TRANSACTIONS_PER_PAGE,
  );
  const groupedPaginatedPayments = useMemo(() => {
    return paginatedPayments.reduce((groups, payment) => {
      const branchName = payment.branch || 'Unassigned Branch';
      if (!groups[branchName]) {
        groups[branchName] = {
          rpt: [],
          bt: [],
          other: [],
        };
      }
      if (payment.tax_type === 'Real Property Tax') {
        groups[branchName].rpt.push(payment);
      } else if (payment.tax_type === 'Business Tax') {
        groups[branchName].bt.push(payment);
      } else {
        groups[branchName].other.push(payment);
      }
      return groups;
    }, {});
  }, [paginatedPayments]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters]);

  const stats = useMemo(() => {
    const total = filteredPayments.length;
    const pending = filteredPayments.filter((payment) => normalizeStatus(payment.status) === 'pending').length;
    const confirmedPayments = filteredPayments.filter((payment) => normalizeStatus(payment.status) === 'confirmed');
    const confirmed = confirmedPayments.length;
    const failed = filteredPayments.filter((payment) => normalizeStatus(payment.status) === 'failed').length;
    const totalCollections = confirmedPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const todayKey = getPaymentDayKey(new Date().toISOString());
    const todaysPayments = filteredPayments.filter((payment) => getPaymentDayKey(payment.created_at) === todayKey).length;

    return {
      total,
      pending,
      confirmed,
      failed,
      totalCollections,
      todaysPayments,
      averageVerifiedValue: confirmed ? totalCollections / confirmed : 0,
    };
  }, [filteredPayments]);

  const paymentMethodChartItems = useMemo(() => {
    return Object.entries(
      filteredPayments.reduce((summary, payment) => {
        const methodLabel = normalizePaymentMethodLabel(payment.payment_method);
        if (!summary[methodLabel]) {
          summary[methodLabel] = { count: 0, amount: 0 };
        }
        summary[methodLabel].count += 1;
        if (normalizeStatus(payment.status) === 'confirmed') {
          summary[methodLabel].amount += payment.amount || 0;
        }
        return summary;
      }, {}),
    )
      .map(([label, values]) => ({
        label,
        count: values.count,
        helper: `${formatCurrency(values.amount)} verified collections`,
      }))
      .sort((left, right) => right.count - left.count || right.label.localeCompare(left.label));
  }, [filteredPayments]);

  const trendPoints = useMemo(() => {
    if (!filteredPayments.length) {
      return [];
    }

    const endDate = appliedFilters.dateTo ? new Date(`${appliedFilters.dateTo}T00:00:00`) : new Date();
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(endDate);
    if (appliedFilters.dateFrom) {
      const requestedStart = new Date(`${appliedFilters.dateFrom}T00:00:00`);
      startDate.setTime(Math.max(requestedStart.getTime(), endDate.getTime() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000));
    } else {
      startDate.setDate(endDate.getDate() - (TREND_DAYS - 1));
    }

    const points = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateKey = getPaymentDayKey(cursor.toISOString());
      const matchingPayments = filteredPayments.filter((payment) => getPaymentDayKey(payment.created_at) === dateKey);
      const confirmedPayments = matchingPayments.filter((payment) => normalizeStatus(payment.status) === 'confirmed');
      points.push({
        label: formatPaymentDate(cursor.toISOString(), { month: 'short', day: 'numeric' }),
        count: matchingPayments.length,
        amount: confirmedPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return points;
  }, [filteredPayments, appliedFilters.dateFrom, appliedFilters.dateTo]);

  const detailAuditTrail = selectedPayment
    ? [
        {
          label: 'Created',
          value: `${formatPaymentDate(selectedPayment.created_at, { year: 'numeric', month: 'short', day: 'numeric' })} at ${formatPaymentDate(selectedPayment.created_at, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          })}`,
        },
        selectedPayment.verified_at
          ? {
              label: 'Verified',
              value: `${formatPaymentDate(selectedPayment.verified_at, { year: 'numeric', month: 'short', day: 'numeric' })} at ${formatPaymentDate(selectedPayment.verified_at, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              })}`,
            }
          : null,
        selectedPayment.paymongo_status
          ? {
              label: 'PayMongo Status',
              value: selectedPayment.paymongo_status,
            }
          : null,
      ].filter(Boolean)
    : [];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#0f2f5f] border-t-transparent" />
          <p className="text-slate-600">Loading branch payment operations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-[32px] bg-gradient-to-b from-slate-100 via-white to-slate-100/80 p-3 md:p-4">
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Payment Management"
        subtitle="Monitor online payment performance, review transaction details, and manage branch collections using a clean operational dashboard."
        actions={(
          <>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current View</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {appliedFilters.dateFrom || 'All dates'} to {appliedFilters.dateTo || 'Today'}
              </p>
            </div>
            <button
              onClick={fetchPayments}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 font-semibold text-[#0f2f5f] shadow-lg shadow-blue-950/10 transition hover:bg-slate-100"
            >
              <DashboardIcon type="trend" />
              Refresh Data
            </button>
          </>
        )}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard icon="wallet" label="Total Payments" value={stats.total} helper="Unique transactions in the current filtered view" />
        <KpiCard icon="check" label="Verified Payments" value={stats.confirmed} helper="Counted once after successful branch verification" />
        <KpiCard icon="clock" label="Pending Payments" value={stats.pending} helper="Still awaiting branch review and verification" />
        <KpiCard icon="alert" label="Failed / Declined" value={stats.failed} helper="Excluded from collection and revenue totals" />
        <KpiCard icon="trend" label="Total Collections" value={formatCurrency(stats.totalCollections)} helper="Verified revenue only for the selected records" />
        <KpiCard icon="clock" label="Today's Payments" value={stats.todaysPayments} helper="Transactions created today in the current branch view" />
      </section>

      <SectionCard
        title="Filter And Search"
        subtitle="Quickly narrow the branch payment list using focused operational filters."
        action={
          <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
            {filteredPayments.length} matched transactions
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Search Bar</label>
            <input
              type="text"
              value={draftFilters.search}
              onChange={(event) => updateDraftFilter('search', event.target.value)}
              placeholder="Search by reference, citizen, TIN, email, tax type, or transaction ID"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Payment Status</label>
            <select
              value={draftFilters.status}
              onChange={(event) => updateDraftFilter('status', event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">All Statuses</option>
              <option value="confirmed">Verified</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed / Declined</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Payment Method</label>
            <select
              value={draftFilters.paymentMethod}
              onChange={(event) => updateDraftFilter('paymentMethod', event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">All Methods</option>
              {paymentMethodOptions.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Tax Type / Service Type</label>
            <select
              value={draftFilters.taxType}
              onChange={(event) => updateDraftFilter('taxType', event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">All Tax Types</option>
              {taxTypeOptions.map((taxType) => (
                <option key={taxType} value={taxType}>{taxType}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Date From</label>
            <input
              type="date"
              max={draftFilters.dateTo || undefined}
              value={draftFilters.dateFrom}
              onChange={(event) => updateDraftFilter('dateFrom', event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Date To</label>
            <input
              type="date"
              min={draftFilters.dateFrom || undefined}
              value={draftFilters.dateTo}
              onChange={(event) => updateDraftFilter('dateTo', event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Transaction Reference No.</label>
            <input
              type="text"
              value={draftFilters.reference}
              onChange={(event) => updateDraftFilter('reference', event.target.value)}
              placeholder="Reference number"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Citizen Name</label>
            <input
              type="text"
              value={draftFilters.citizenName}
              onChange={(event) => updateDraftFilter('citizenName', event.target.value)}
              placeholder="Taxpayer name"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">TIN</label>
            <input
              type="text"
              value={draftFilters.tin}
              onChange={(event) => updateDraftFilter('tin', event.target.value)}
              placeholder="Taxpayer TIN"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
            <input
              type="text"
              value={draftFilters.email}
              onChange={(event) => updateDraftFilter('email', event.target.value)}
              placeholder="Citizen email"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={applyFilters}
            className="rounded-2xl bg-[#0f2f5f] px-5 py-3 font-semibold text-white transition hover:bg-[#19498d]"
          >
            Apply Filter
          </button>
          <button
            onClick={resetFilters}
            className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300"
          >
            Reset Filter
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Payment Monitoring Analytics"
        subtitle="A quick visual read of method distribution, verification mix, and recent payment trends."
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-300 bg-slate-50/90 p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-base font-bold text-slate-900">Payments By Method</h3>
              <p className="mt-1 text-sm text-slate-500">Method totals from the same filtered payment records shown in the table.</p>
            </div>
            <MiniBarChart items={paymentMethodChartItems} />
          </div>
          <div className="rounded-3xl border border-slate-300 bg-slate-50/90 p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-base font-bold text-slate-900">Verification Status Mix</h3>
              <p className="mt-1 text-sm text-slate-500">Verified, pending, and failed transactions for the current branch view.</p>
            </div>
            <DoughnutStatusChart values={stats} />
          </div>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <TrendChart
            title="Payment Trend Over Time"
            subtitle="Transaction volume across the most recent operational days."
            points={trendPoints}
            color="#0f2f5f"
            valueKey="count"
          />
          <TrendChart
            title="Revenue Trend"
            subtitle="Verified collections over the same recent days."
            points={trendPoints}
            color="#0f766e"
            valueKey="amount"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Transactions By Branch"
        subtitle="Newest transactions are grouped into branch-specific tables for cleaner monitoring and future multi-branch expansion."
        action={
          <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
            {filteredPayments.length} transactions
          </div>
        }
      >
        {!filteredPayments.length ? (
          <div className="rounded-2xl border border-slate-300 bg-white px-6 py-14 text-center shadow-inner">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <DashboardIcon type="wallet" />
            </div>
            <p className="mt-4 text-base font-semibold text-slate-700">No matching branch payments found.</p>
            <p className="mt-1 text-sm text-slate-500">Try adjusting the filters or search fields to widen the result set.</p>
          </div>
        ) : null}

        {Object.entries(groupedPaginatedPayments).map(([branchName, branchGroups]) => (
          <div key={branchName} className="mb-5 last:mb-0">
            <div className="mb-3 flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Branch Table</p>
                <p className="mt-1 text-base font-bold text-[#0f2f5f]">{branchName}</p>
              </div>
              <span className="rounded-full bg-[#0f2f5f] px-3 py-1 text-xs font-semibold text-white">
                {(branchGroups.rpt.length + branchGroups.bt.length + branchGroups.other.length)} transaction{(branchGroups.rpt.length + branchGroups.bt.length + branchGroups.other.length) === 1 ? '' : 's'}
              </span>
            </div>

            {[
              { key: 'rpt', title: 'RPT Transactions', items: branchGroups.rpt },
              { key: 'bt', title: 'BT Transactions', items: branchGroups.bt },
              { key: 'other', title: 'Other Transactions', items: branchGroups.other },
            ].filter((section) => section.items.length).map((section) => (
              <div key={`${branchName}-${section.key}`} className="mb-4 last:mb-0">
                <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-bold text-slate-800">{section.title}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                    {section.items.length} item{section.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-slate-300 bg-white shadow-inner">
                  <table className="min-w-[1180px] w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
                      <tr>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Reference Number</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Date</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Time</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Citizen Name</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">TIN</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Payment Method</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Tax Type</th>
                        <th className="px-5 py-4 text-right font-semibold uppercase tracking-[0.12em]">Amount</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Status</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {section.items.map((payment) => (
                        <tr key={payment.id} className="transition hover:bg-slate-50">
                          <td className="px-5 py-4 align-top">
                            <p className="font-mono text-sm font-semibold text-[#0f2f5f]">{payment.ref_number || 'N/A'}</p>
                            <p className="mt-1 text-xs text-slate-500">{payment.transaction_id || 'No transaction ID'}</p>
                          </td>
                          <td className="px-5 py-4 align-top text-slate-700">
                            {formatPaymentDate(payment.created_at, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </td>
                          <td className="px-5 py-4 align-top text-slate-700">
                            {formatPaymentDate(payment.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                          </td>
                          <td className="px-5 py-4 align-top">
                            <p className="font-semibold text-slate-900">{payment.taxpayer_name || 'N/A'}</p>
                            <p className="mt-1 text-xs text-slate-500">{payment.email || 'No email provided'}</p>
                          </td>
                          <td className="px-5 py-4 align-top text-slate-700">{payment.tin || 'N/A'}</td>
                          <td className="px-5 py-4 align-top text-slate-700">{normalizePaymentMethodLabel(payment.payment_method)}</td>
                          <td className="px-5 py-4 align-top text-slate-700">{payment.tax_type || 'N/A'}</td>
                          <td className="px-5 py-4 text-right align-top font-semibold text-slate-900">{formatCurrency(payment.amount)}</td>
                          <td className="px-5 py-4 align-top">
                            <StatusBadge status={payment.status} />
                          </td>
                          <td className="px-5 py-4 align-top">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => handleViewDetails(payment)}
                                className="rounded-xl bg-[#0f2f5f] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#19498d]"
                              >
                                View
                              </button>
                              {isProcessingPayment(payment) ? (
                                <>
                                  <button
                                    onClick={() => handleVerifyClick(payment)}
                                    className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                  >
                                    Verify
                                  </button>
                                  <button
                                    onClick={() => handleDeclineClick(payment)}
                                    className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                                  >
                                    Decline
                                  </button>
                                </>
                              ) : null}
                              <button
                                onClick={() => handleDeleteClick(payment)}
                                className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}

        {filteredPayments.length ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-500">
              Showing {(safeCurrentPage - 1) * TRANSACTIONS_PER_PAGE + 1}-{Math.min(safeCurrentPage * TRANSACTIONS_PER_PAGE, filteredPayments.length)} of {filteredPayments.length} transactions
              <p className="mt-1 text-xs text-slate-400">Verified collections in this view: {formatCurrency(stats.totalCollections)}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                disabled={safeCurrentPage === 1}
                className="rounded-2xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                Page {safeCurrentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                disabled={safeCurrentPage === totalPages}
                className="rounded-2xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {showVerifyModal && paymentToVerify ? (
        <ConfirmationModal
          title="Confirm Payment Verification"
          message="This payment is still processing. Please double-check the transaction details before verifying it for the branch."
          details={[
            { label: 'Reference', value: paymentToVerify.ref_number || 'N/A' },
            { label: 'Citizen', value: paymentToVerify.taxpayer_name || 'N/A' },
            { label: 'Amount', value: formatCurrency(paymentToVerify.amount) },
            { label: 'Current Status', value: 'Processing' },
            { label: 'Payment Proof', value: paymentToVerify.proof_file_name || 'No uploaded proof found' },
          ]}
          warning="Verify this payment only after confirming that the underlying transaction was successfully completed and reviewing any uploaded taxpayer proof."
          cancelLabel="Cancel"
          confirmLabel="Confirm Verify"
          confirmClassName="bg-emerald-600 hover:bg-emerald-700"
          onCancel={handleVerifyCancel}
          onConfirm={handleVerifyConfirm}
          loading={verifying}
          iconType="check"
        />
      ) : null}

      {showDeleteModal && paymentToDelete ? (
        <ConfirmationModal
          title="Delete Transaction"
          message="Removing this payment will permanently delete it from the branch payment records."
          details={[
            { label: 'Reference', value: paymentToDelete.ref_number || 'N/A' },
            { label: 'Citizen', value: paymentToDelete.taxpayer_name || 'N/A' },
            { label: 'Amount', value: formatCurrency(paymentToDelete.amount) },
          ]}
          warning="This action cannot be undone."
          cancelLabel="No, Cancel"
          confirmLabel="Yes, Delete"
          confirmClassName="bg-rose-600 hover:bg-rose-700"
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          loading={deleting}
          iconType="alert"
        />
      ) : null}

      {showDeclineModal && paymentToDecline ? (
        <ConfirmationModal
          title="Decline Payment"
          message="Declining this payment will move it out of the pending queue for this branch."
          details={[
            { label: 'Reference', value: paymentToDecline.ref_number || 'N/A' },
            { label: 'Citizen', value: paymentToDecline.taxpayer_name || 'N/A' },
            { label: 'Amount', value: formatCurrency(paymentToDecline.amount) },
          ]}
          warning="This will mark the payment as failed for branch-side monitoring."
          cancelLabel="No, Cancel"
          confirmLabel="Yes, Decline"
          confirmClassName="bg-amber-600 hover:bg-amber-700"
          onCancel={handleDeclineCancel}
          onConfirm={handleDeclineConfirm}
          loading={declining}
          iconType="alert"
        />
      ) : null}

      {showDetailModal && selectedPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between bg-[#0f2f5f] px-6 py-5 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Transaction Details</p>
                <h2 className="mt-1 text-2xl font-bold">{selectedPayment.ref_number || 'Payment Record'}</h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="space-y-6 px-6 py-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-3xl border border-[#173b72] bg-[#0f2f5f] p-5 text-white">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-200">Payment Reference</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Reference Number</p>
                      <p className="mt-1 font-mono text-lg font-bold text-white">{selectedPayment.ref_number || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Transaction ID</p>
                      <p className="mt-1 font-mono text-sm text-slate-100">{selectedPayment.transaction_id || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Status</p>
                      <div className="mt-1">
                        <StatusBadge status={selectedPayment.status} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Branch</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{selectedPayment.branch || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-emerald-900">Taxpayer Information</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Citizen Name</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedPayment.taxpayer_name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">TIN</p>
                      <p className="mt-1 text-sm text-slate-900">{selectedPayment.tin || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</p>
                      <p className="mt-1 text-sm text-slate-900">{selectedPayment.email || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property / Business Reference</p>
                      <p className="mt-1 text-sm text-slate-900">{selectedPayment.property_ref_number || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-3xl border border-purple-100 bg-purple-50 p-5">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-purple-900">Payment Breakdown</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Method</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{normalizePaymentMethodLabel(selectedPayment.payment_method)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tax / Service Type</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedPayment.tax_type || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</p>
                      <p className="mt-1 text-2xl font-bold text-emerald-700">{formatCurrency(selectedPayment.amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source Module</p>
                      <p className="mt-1 text-sm text-slate-900">{selectedPayment.source_module || 'tax_payment'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-amber-100 bg-amber-50 p-5">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-amber-900">Date And Time</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date Created</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {formatPaymentDate(selectedPayment.created_at, { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time Created</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {formatPaymentDate(selectedPayment.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date Verified</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {selectedPayment.verified_at
                          ? formatPaymentDate(selectedPayment.verified_at, { year: 'numeric', month: 'long', day: 'numeric' })
                          : 'Not yet verified'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time Verified</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {selectedPayment.verified_at
                          ? formatPaymentDate(selectedPayment.verified_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
                          : 'Not yet verified'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-900">Audit Trail / Payment History</h3>
                  <div className="mt-4 space-y-3">
                    {detailAuditTrail.length ? detailAuditTrail.map((entry) => (
                      <div key={entry.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{entry.label}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{entry.value}</p>
                      </div>
                    )) : (
                      <p className="text-sm text-slate-500">No audit history available for this payment.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-900">Receipt Preview / Payment Processor</h3>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Uploaded Payment Proof</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedPayment.proof_file_name || 'No uploaded proof on this transaction'}</p>
                      {selectedPayment.proof_uploaded_at ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Uploaded on {formatPaymentDate(selectedPayment.proof_uploaded_at, { year: 'numeric', month: 'long', day: 'numeric' })} at{' '}
                          {formatPaymentDate(selectedPayment.proof_uploaded_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                        </p>
                      ) : null}
                      {selectedPayment.proof_download_url ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <a
                            href={buildApiAssetUrl(selectedPayment.proof_download_url)}
                            download
                            className="rounded-xl bg-[#0f2f5f] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#19498d]"
                          >
                            Download Proof
                          </a>
                        </div>
                      ) : null}
                    </div>
                    {selectedPayment.bt_application ? (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business Tax Uploaded Files</p>
                        <div className="mt-2 space-y-2 text-sm text-slate-700">
                          <p>Tracking Number: <span className="font-semibold text-slate-900">{selectedPayment.bt_application.tracking_number}</span></p>
                          <p>Business Name: <span className="font-semibold text-slate-900">{selectedPayment.bt_application.business_name}</span></p>
                          <p>Mayor&apos;s Permit Number: <span className="font-semibold text-slate-900">{selectedPayment.bt_application.mayor_permit_number}</span></p>
                          <p>SEC/DTI/CDA Number: <span className="font-semibold text-slate-900">{selectedPayment.bt_application.sec_dti_cda_number}</span></p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedPayment.bt_application.sales_declaration_download_url ? (
                            <a href={buildApiAssetUrl(selectedPayment.bt_application.sales_declaration_download_url)} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-200">
                              Sales Declaration
                            </a>
                          ) : null}
                          {selectedPayment.bt_application.financial_statements_download_url ? (
                            <a href={buildApiAssetUrl(selectedPayment.bt_application.financial_statements_download_url)} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-200">
                              Financial Statements
                            </a>
                          ) : null}
                          {selectedPayment.bt_application.supporting_documents_download_url ? (
                            <a href={buildApiAssetUrl(selectedPayment.bt_application.supporting_documents_download_url)} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-200">
                              Supporting Documents
                            </a>
                          ) : null}
                          {selectedPayment.bt_application.proof_of_payment_download_url ? (
                            <a href={buildApiAssetUrl(selectedPayment.bt_application.proof_of_payment_download_url)} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-200">
                              Proof Of Payment
                            </a>
                          ) : null}
                          {selectedPayment.bt_application.official_receipt_download_url ? (
                            <a href={buildApiAssetUrl(selectedPayment.bt_application.official_receipt_download_url)} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200">
                              Official Receipt
                            </a>
                          ) : null}
                        </div>
                        {selectedPayment.bt_application.verifier_remarks ? (
                          <p className="mt-3 text-xs text-amber-700">{selectedPayment.bt_application.verifier_remarks}</p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checkout Session ID</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-900">{selectedPayment.paymongo_checkout_session_id || 'Not available'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Intent ID</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-900">{selectedPayment.paymongo_payment_intent_id || 'Not available'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment ID</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-900">{selectedPayment.paymongo_payment_id || 'Not available'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Processor Status</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedPayment.paymongo_status || 'Not available'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row">
                {isProcessingPayment(selectedPayment) ? (
                  <button
                    onClick={() => {
                      handleVerifyClick(selectedPayment);
                      setShowDetailModal(false);
                    }}
                    className="rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700"
                  >
                    Verify Payment
                  </button>
                ) : null}
                {isProcessingPayment(selectedPayment) ? (
                  <button
                    onClick={() => {
                      handleDeclineClick(selectedPayment);
                      setShowDetailModal(false);
                    }}
                    className="rounded-2xl bg-amber-600 px-5 py-3 font-semibold text-white transition hover:bg-amber-700"
                  >
                    Decline Payment
                  </button>
                ) : null}
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PaymentManagement;
