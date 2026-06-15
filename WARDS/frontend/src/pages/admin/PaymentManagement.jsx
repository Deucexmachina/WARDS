import { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import WardsPageHero from '../../components/WardsPageHero';
import SystemMessageModal from '../../components/SystemMessageModal';
import CollectionReportView from '../../components/admin/CollectionReportView';

const API_BASE_URL = 'http://localhost:8000/api';
const PAYMENT_TIME_ZONE = 'Asia/Manila';
const LEDGER_PER_PAGE = 5;

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

const formatBranchRemittanceDate = (value) => {
  if (!value) return 'N/A';
  return formatPaymentDate(value, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getCollectionMonthLabel = () => new Date().toLocaleDateString('en-PH', {
  month: 'long',
  timeZone: PAYMENT_TIME_ZONE,
  year: 'numeric',
});

const getMonthValueFromDate = (value) => {
  const parsedDate = value ? parsePaymentDate(value) : new Date();
  if (!parsedDate) return '';
  const parts = new Intl.DateTimeFormat('en-PH', {
    month: '2-digit',
    timeZone: PAYMENT_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(parsedDate);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
};

const getCollectionMonthLabelFromValue = (value) => {
  if (!value) return getCollectionMonthLabel();
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return getCollectionMonthLabel();
  return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
    month: 'long',
    timeZone: PAYMENT_TIME_ZONE,
    year: 'numeric',
  });
};

const isRecordInMonth = (value, monthValue) => getMonthValueFromDate(value) === monthValue;

const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const normalizeStatus = (status) => {
  const normalized = (status || '').toString().trim().toLowerCase();
  if (['confirmed', 'verified', 'paid', 'succeeded', 'successful', 'success'].includes(normalized)) {
    return 'confirmed';
  }
  if (normalized === 'expired') return 'expired';
  if (['failed', 'declined', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
  return 'pending';
};

const statusStyles = {
  confirmed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  expired: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  failed: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const getStatusLabel = (status) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'confirmed') return 'Verified';
  if (normalized === 'expired') return 'Expired';
  if (normalized === 'failed') return 'Failed';
  return 'Pending';
};

const isPlaceholderBranchName = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return !normalized || normalized === 'BRANCH_NAME' || normalized === 'BRANCH';
};

const formatBranchLabel = (value, branchId) => {
  if (!isPlaceholderBranchName(value)) {
    return value;
  }
  if (branchId) {
    return `Branch ${branchId}`;
  }
  return 'Unassigned Branch';
};

const getBranchName = (payment, branchLookup = {}) => {
  const branchId = payment.branch_id || payment.metadata?.selected_branch_id;
  return (
    branchLookup[branchId]
    || formatBranchLabel(
      payment.branch_name
      || payment.branch
      || payment.selected_branch_name
      || payment.metadata?.selected_branch_name,
      branchId,
    )
  );
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const buildReportRows = (branchSummaries) => branchSummaries.map((branch) => `
  <tr>
    <td>${escapeHtml(branch.branch)}</td>
    <td>${branch.totalPayments}</td>
    <td>${formatCurrency(branch.verifiedAmount)}</td>
    <td>${formatCurrency(branch.remittedAmount)}</td>
    <td>${formatCurrency(branch.pendingRemittanceAmount)}</td>
    <td>${escapeHtml(branch.remittedBy || 'N/A')}</td>
    <td>${escapeHtml(formatBranchRemittanceDate(branch.remittedAt))}</td>
    <td>${escapeHtml(branch.verifiedBy || 'Pending Main Review')}</td>
    <td>${escapeHtml(formatBranchRemittanceDate(branch.verifiedAt))}</td>
    <td>${branch.verifiedCount}</td>
  </tr>
`).join('');

const buildRankingRows = (rankedBranches, totalVerifiedAmount) => rankedBranches.map((branch, index) => {
  const collectionShare = totalVerifiedAmount > 0 ? (branch.verifiedAmount / totalVerifiedAmount) * 100 : 0;
  const remittanceBase = branch.remittedAmount + branch.pendingRemittanceAmount;
  const remittanceRate = remittanceBase > 0 ? (branch.remittedAmount / remittanceBase) * 100 : 0;
  return `
    <tr>
      <td class="rank-cell">#${index + 1}</td>
      <td>${escapeHtml(branch.branch)}</td>
      <td>${formatCurrency(branch.verifiedAmount)}</td>
      <td>${collectionShare.toFixed(1)}%</td>
      <td>${remittanceRate.toFixed(1)}%</td>
      <td>${branch.verifiedCount}</td>
    </tr>
  `;
}).join('');

const buildCollectionBars = (rankedBranches, maxVerifiedAmount) => rankedBranches.slice(0, 8).map((branch, index) => {
  const width = maxVerifiedAmount > 0 ? Math.max(4, (branch.verifiedAmount / maxVerifiedAmount) * 100) : 0;
  return `
    <div class="bar-row">
      <div class="bar-label">#${index + 1} ${escapeHtml(branch.branch)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      <div class="bar-value">${formatCurrency(branch.verifiedAmount)}</div>
    </div>
  `;
}).join('');

const buildRemittanceBars = (rankedBranches) => rankedBranches.slice(0, 8).map((branch) => {
  const remittanceBase = branch.remittedAmount + branch.pendingRemittanceAmount;
  const width = remittanceBase > 0 ? (branch.remittedAmount / remittanceBase) * 100 : 0;
  return `
    <div class="bar-row">
      <div class="bar-label">${escapeHtml(branch.branch)}</div>
      <div class="bar-track amber"><div class="bar-fill green" style="width:${width}%"></div></div>
      <div class="bar-value">${width.toFixed(1)}%</div>
    </div>
  `;
}).join('');

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const RemittanceActionModal = ({
  open,
  title,
  message,
  details = [],
  confirmLabel,
  loadingLabel,
  isLoading,
  errorMessage,
  confirmClassName = 'bg-emerald-600 hover:bg-emerald-700',
  onConfirm,
  onCancel,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl md:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z"></path>
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-500">Confirmation Required</p>
            <h3 className="mt-2 text-2xl font-bold text-primary">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>

        {details.length > 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="space-y-3">
              {details.map((detail) => (
                <div key={`${detail.label}-${detail.value || 'empty'}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{detail.label}</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{detail.value || 'N/A'}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded-2xl px-5 py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70 ${confirmClassName}`}
          >
            {isLoading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const PaymentManagement = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const [payments, setPayments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [remittanceData, setRemittanceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showCollectionReportModal, setShowCollectionReportModal] = useState(false);
  const [remittanceActionModal, setRemittanceActionModal] = useState({ action: null, remittance: null });
  const [remittanceActionLoading, setRemittanceActionLoading] = useState(false);
  const [remittanceActionError, setRemittanceActionError] = useState('');
  const [pageError, setPageError] = useState('');
  const [messageModal, setMessageModal] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [ledgerPages, setLedgerPages] = useState({});
  const currentMonthValue = useMemo(() => getMonthValueFromDate(), []);
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthValueFromDate());
  const collectionMonthLabel = useMemo(() => getCollectionMonthLabelFromValue(selectedMonth), [selectedMonth]);
  const collectionReportTitle = `Tax Collection: ${collectionMonthLabel}`;

  const handleCollectionMonthChange = (value) => {
    setSelectedMonth(value === currentMonthValue ? value : currentMonthValue);
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  useEffect(() => {
    setLedgerPages({});
  }, [filter, selectedMonth]);

  const closeRemittanceActionModal = () => {
    if (remittanceActionLoading) {
      return;
    }
    setRemittanceActionModal({ action: null, remittance: null });
    setRemittanceActionError('');
  };

  const fetchPayments = async () => {
    try {
      setPageError('');
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      let url = `${API_BASE_URL}/payments`;

      if (user.role === 'branch_admin' || user.role === 'branch_staff') {
        const branchResponse = await axios.get(`${API_BASE_URL}/public/branches`);
        const branch = branchResponse.data.find((item) => item.id === user.branch_id);
        if (branch) {
          url += `?branch=${encodeURIComponent(branch.name)}`;
        }
      }

      const [response, branchesResponse] = await Promise.all([
        axios.get(url),
        axios.get(`${API_BASE_URL}/public/branches`),
      ]);
      setPayments(response.data || []);
      setBranches(branchesResponse.data || []);
      await fetchRemittances();
    } catch (error) {
      console.error('Failed to fetch payments:', error);
      setPageError('Failed to load tax collection records.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRemittances = async () => {
    const token = localStorage.getItem('adminToken');
    try {
      const response = await axios.get(`${API_BASE_URL}/payments/remittances`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setRemittanceData(response.data);
    } catch (error) {
      console.error('Failed to fetch remittances:', error);
      setPageError(error.response?.data?.detail || 'Failed to load remittance records.');
    }
  };

  const reviewRemittance = async (remittanceId, action) => {
    try {
      const token = localStorage.getItem('adminToken');
      await axios.post(`${API_BASE_URL}/payments/remittances/${remittanceId}/${action}`, {}, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setSuccessMessage(`Remittance ${action === 'accept' ? 'accepted' : 'rejected'} successfully.`);
      await fetchRemittances();
    } catch (error) {
      console.error('Failed to review remittance:', error);
      throw new Error(error.response?.data?.detail || 'Failed to review remittance');
    }
  };

  const downloadRemittanceReport = async (remittance) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await axios.get(`${API_BASE_URL}/payments/remittances/${remittance.id}/report`, {
        responseType: 'blob',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = remittance.report_file_name || `${remittance.remittance_number}-report`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Failed to download remittance report:', error);
      setPageError(error.response?.data?.detail || 'Failed to download remittance report');
    }
  };

  const handleVerifyPayment = async (paymentId) => {
    try {
      await axios.put(`${API_BASE_URL}/payments/${paymentId}/verify`);
      window.dispatchEvent(new CustomEvent('receipt-payment-updated', { detail: { action: 'verified', paymentId } }));
      window.dispatchEvent(new CustomEvent('branch-payment-updated', { detail: { action: 'verified', paymentId } }));
      setMessageModal({
        tone: 'success',
        title: 'Payment Verified',
        message: 'The payment was verified successfully.',
      });
      fetchPayments();
    } catch (error) {
      console.error('Failed to verify payment:', error);
    }
  };

  const monthlyPayments = useMemo(() => (
    payments
      .filter((payment) => isRecordInMonth(payment.verified_at || payment.created_at, selectedMonth))
      .sort((a, b) => {
        const dateA = parsePaymentDate(a.created_at);
        const dateB = parsePaymentDate(b.created_at);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB.getTime() - dateA.getTime();
      })
  ), [payments, selectedMonth]);

  const monthlyRemittances = useMemo(() => (
    (remittanceData?.remittances || []).filter((remittance) => (
      isRecordInMonth(remittance.reviewed_at || remittance.submitted_at, selectedMonth)
    ))
  ), [remittanceData, selectedMonth]);

  const pendingReviewRemittances = useMemo(() => (
    monthlyRemittances.filter((remittance) => remittance.status === 'Submitted')
  ), [monthlyRemittances]);

  const filteredPayments = useMemo(() => (
    monthlyPayments.filter((payment) => {
      if (filter === 'all') return true;
      return normalizeStatus(payment.status) === filter;
    })
  ), [monthlyPayments, filter]);

  const branchLookup = useMemo(() => (
    branches.reduce((lookup, branch) => {
      lookup[branch.id] = branch.name;
      lookup[String(branch.id)] = branch.name;
      return lookup;
    }, {})
  ), [branches]);

  const groupedLedgerPayments = useMemo(() => {
    const groups = new Map();
    filteredPayments.forEach((payment) => {
      const branchName = getBranchName(payment, branchLookup);
      if (!groups.has(branchName)) {
        groups.set(branchName, []);
      }
      groups.get(branchName).push(payment);
    });
    return Array.from(groups.entries()).map(([branchName, records]) => ({ branchName, records }));
  }, [filteredPayments, branchLookup]);

  const paymentStats = useMemo(() => {
    const confirmedPayments = monthlyPayments.filter((payment) => normalizeStatus(payment.status) === 'confirmed');
    const pendingPayments = monthlyPayments.filter((payment) => normalizeStatus(payment.status) === 'pending');
    const failedPayments = monthlyPayments.filter((payment) => ['failed', 'expired'].includes(normalizeStatus(payment.status)));
    return {
      totalPayments: monthlyPayments.length,
      pendingCount: pendingPayments.length,
      verifiedCount: confirmedPayments.length,
      failedCount: failedPayments.length,
      verifiedAmount: confirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    };
  }, [monthlyPayments]);

  const branchSummaries = useMemo(() => {
    const byBranch = new Map();
    monthlyPayments.forEach((payment) => {
      const branch = getBranchName(payment, branchLookup);
      if (!byBranch.has(branch)) {
        byBranch.set(branch, {
          branch,
          totalPayments: 0,
          verifiedCount: 0,
          pendingCount: 0,
          failedCount: 0,
          verifiedAmount: 0,
          remittedAmount: 0,
          pendingRemittanceAmount: 0,
          remittedAt: null,
          remittedBy: '',
          verifiedAt: null,
          verifiedBy: '',
          _latestRemittedAtTs: 0,
          _latestVerifiedAtTs: 0,
        });
      }
      const summary = byBranch.get(branch);
      const status = normalizeStatus(payment.status);
      summary.totalPayments += 1;
      if (status === 'confirmed') {
        summary.verifiedCount += 1;
        summary.verifiedAmount += Number(payment.amount || 0);
      } else if (status === 'pending') {
        summary.pendingCount += 1;
      } else {
        summary.failedCount += 1;
      }
    });

    monthlyRemittances.forEach((remittance) => {
      const branch = branchLookup[remittance.branch_id] || formatBranchLabel(remittance.branch_name, remittance.branch_id);
      if (!byBranch.has(branch)) {
        byBranch.set(branch, {
          branch,
          totalPayments: 0,
          verifiedCount: 0,
          pendingCount: 0,
          failedCount: 0,
          verifiedAmount: 0,
          remittedAmount: 0,
          pendingRemittanceAmount: 0,
          remittedAt: null,
          remittedBy: '',
          verifiedAt: null,
          verifiedBy: '',
          _latestRemittedAtTs: 0,
          _latestVerifiedAtTs: 0,
        });
      }
      const summary = byBranch.get(branch);
      const submittedAtTs = parsePaymentDate(remittance.submitted_at)?.getTime() || 0;
      const reviewedAtTs = parsePaymentDate(remittance.reviewed_at)?.getTime() || 0;

      if (submittedAtTs >= summary._latestRemittedAtTs) {
        summary._latestRemittedAtTs = submittedAtTs;
        summary.remittedAt = remittance.submitted_at || null;
        summary.remittedBy = remittance.submitted_by || '';
      }

      if (remittance.status === 'Accepted') {
        summary.remittedAmount += Number(remittance.total_amount || 0);
        if (reviewedAtTs >= summary._latestVerifiedAtTs) {
          summary._latestVerifiedAtTs = reviewedAtTs;
          summary.verifiedAt = remittance.reviewed_at || null;
          summary.verifiedBy = remittance.reviewed_by || '';
        }
      }
      if (remittance.status === 'Submitted') {
        summary.pendingRemittanceAmount += Number(remittance.total_amount || 0);
      }
    });

    return Array.from(byBranch.values())
      .map(({ _latestRemittedAtTs, _latestVerifiedAtTs, ...summary }) => summary)
      .sort((left, right) => right.verifiedAmount - left.verifiedAmount || left.branch.localeCompare(right.branch));
  }, [monthlyPayments, monthlyRemittances, branchLookup]);

  const pendingRemittanceAmount = monthlyRemittances
    .filter((remittance) => remittance.status === 'Submitted')
    .reduce((sum, remittance) => sum + Number(remittance.total_amount || 0), 0);
  const acceptedRemittanceAmount = monthlyRemittances
    .filter((remittance) => remittance.status === 'Accepted')
    .reduce((sum, remittance) => sum + Number(remittance.total_amount || 0), 0);
  const mainCollectionAmount = acceptedRemittanceAmount;
  const rankedBranches = useMemo(() => (
    [...branchSummaries].sort((left, right) => (
      right.verifiedAmount - left.verifiedAmount
      || right.remittedAmount - left.remittedAmount
      || right.verifiedCount - left.verifiedCount
      || left.branch.localeCompare(right.branch)
    ))
  ), [branchSummaries]);
  const branchAnalytics = useMemo(() => {
    const activeBranches = branchSummaries.filter((branch) => branch.totalPayments > 0 || branch.remittedAmount > 0 || branch.pendingRemittanceAmount > 0);
    const totalVerifiedAmount = branchSummaries.reduce((sum, branch) => sum + Number(branch.verifiedAmount || 0), 0);
    const totalRemittanceFlow = acceptedRemittanceAmount + pendingRemittanceAmount;
    return {
      activeBranchCount: activeBranches.length,
      leadingBranch: rankedBranches[0] || null,
      averageVerifiedAmount: activeBranches.length ? totalVerifiedAmount / activeBranches.length : 0,
      totalVerifiedAmount,
      maxVerifiedAmount: rankedBranches[0]?.verifiedAmount || 0,
      remittanceCompletionRate: totalRemittanceFlow > 0 ? (acceptedRemittanceAmount / totalRemittanceFlow) * 100 : 0,
    };
  }, [branchSummaries, rankedBranches, acceptedRemittanceAmount, pendingRemittanceAmount]);

  const buildCollectionReportHtml = ({ includeToolbar = true } = {}) => {
    const generatedAt = new Date().toLocaleString('en-PH', { timeZone: PAYMENT_TIME_ZONE });
    return `
      <!doctype html>
      <html>
        <head>
          <title>WARDS ${escapeHtml(collectionReportTitle)}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; background: #edf3f8; }
            .preview-shell { min-height: 100vh; padding: 24px; }
            .preview-toolbar { align-items: center; background: #0f2f5f; border-radius: 18px; box-shadow: 0 18px 40px rgba(15, 47, 95, 0.18); color: white; display: flex; gap: 18px; justify-content: space-between; margin: 0 auto 18px; max-width: 1120px; padding: 18px 22px; }
            .toolbar-copy { max-width: 620px; }
            .preview-toolbar span { color: #bfdbfe; display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; }
            .preview-toolbar strong { display: block; font-size: 22px; margin-top: 4px; }
            .toolbar-note { color: #dbeafe; font-size: 12px; line-height: 1.5; margin: 6px 0 0; }
            .toolbar-actions { display: flex; flex-wrap: wrap; gap: 10px; }
            .toolbar-button { border: 1px solid rgba(255,255,255,0.25); border-radius: 14px; cursor: pointer; font-size: 13px; font-weight: 800; padding: 11px 16px; }
            .toolbar-button.primary { background: white; color: #0f2f5f; }
            .toolbar-button.secondary { background: rgba(255,255,255,0.1); color: white; }
            .toolbar-button:focus { outline: 3px solid rgba(191, 219, 254, 0.8); outline-offset: 2px; }
            .report-page { background: white; border: 1px solid #cbd5e1; border-radius: 18px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.14); margin: 0 auto; max-width: 1120px; padding: 30px; }
            .header { border-bottom: 3px solid #123a70; padding-bottom: 18px; margin-bottom: 24px; }
            .eyebrow { color: #4f6480; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; }
            h1 { color: #0f2f5f; margin: 8px 0 4px; font-size: 30px; }
            .meta { color: #52637a; font-size: 12px; }
            .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
            .kpi { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; }
            .kpi span { display: block; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
            .kpi strong { display: block; margin-top: 8px; font-size: 20px; color: #0f2f5f; }
            h2 { color: #0f2f5f; font-size: 18px; margin: 26px 0 10px; }
            .analytics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
            .analytics-card { background: #f8fafc; border: 1px solid #dbe3ec; border-radius: 12px; padding: 12px; }
            .analytics-card span { display: block; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
            .analytics-card strong { display: block; margin-top: 7px; color: #0f172a; font-size: 15px; }
            .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
            .chart-card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; }
            .chart-card h3 { margin: 0 0 12px; color: #0f2f5f; font-size: 14px; }
            .bar-row { display: grid; grid-template-columns: 150px 1fr 92px; align-items: center; gap: 10px; margin: 9px 0; }
            .bar-label { color: #334155; font-size: 11px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .bar-track { height: 12px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
            .bar-track.amber { background: #fef3c7; }
            .bar-fill { height: 100%; background: #0f2f5f; border-radius: inherit; }
            .bar-fill.green { background: #059669; }
            .bar-value { color: #475569; font-size: 11px; font-weight: 700; text-align: right; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #eef4fb; color: #334155; text-align: left; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
            th, td { border-bottom: 1px solid #dbe3ec; padding: 10px; }
            .rank-cell { color: #0f2f5f; font-weight: 800; }
            .footer { margin-top: 28px; color: #64748b; font-size: 11px; }
            @media (max-width: 760px) {
              .preview-shell { padding: 14px; }
              .preview-toolbar { align-items: stretch; flex-direction: column; }
              .toolbar-actions { display: grid; grid-template-columns: 1fr; }
              .kpis, .analytics, .charts { grid-template-columns: 1fr; }
              .report-page { padding: 18px; }
            }
            @media print {
              body { background: white; }
              .preview-shell { padding: 0; }
              .preview-toolbar { display: none; }
              .report-page { border: 0; border-radius: 0; box-shadow: none; margin: 0; max-width: none; padding: 20px; }
              .charts { grid-template-columns: 1fr; }
              .analytics { grid-template-columns: repeat(2, 1fr); }
            }
          </style>
        </head>
        <body>
          <div class="preview-shell">
            ${includeToolbar ? `
            <div class="preview-toolbar">
              <div class="toolbar-copy">
                <span>WARDS Main Admin</span>
                <strong>${escapeHtml(collectionReportTitle)} Preview</strong>
                <p class="toolbar-note">Review branch rankings, collection analytics, and remittance totals before printing.</p>
              </div>
              <div class="toolbar-actions">
                <button class="toolbar-button secondary" type="button" onclick="window.close()">Close Preview</button>
                <button class="toolbar-button primary" type="button" onclick="window.print()">Print Report</button>
              </div>
            </div>` : ''}
            <main class="report-page">
              <div class="header">
                <div class="eyebrow">WARDS Main Admin</div>
                <h1>${escapeHtml(collectionReportTitle)}</h1>
                <div class="meta">Generated ${escapeHtml(generatedAt)}</div>
              </div>
              <div class="kpis">
                <div class="kpi"><span>Main Collection Account</span><strong>${formatCurrency(mainCollectionAmount)}</strong></div>
                <div class="kpi"><span>Verified System Collections</span><strong>${formatCurrency(paymentStats.verifiedAmount)}</strong></div>
                <div class="kpi"><span>Pending Remittance</span><strong>${formatCurrency(pendingRemittanceAmount)}</strong></div>
              </div>
              <h2>Collection Performance Analytics</h2>
              <div class="analytics">
                <div class="analytics-card"><span>Top Branch</span><strong>${escapeHtml(branchAnalytics.leadingBranch?.branch || 'N/A')}</strong></div>
                <div class="analytics-card"><span>Top Collection</span><strong>${formatCurrency(branchAnalytics.leadingBranch?.verifiedAmount || 0)}</strong></div>
                <div class="analytics-card"><span>Average Branch Collection</span><strong>${formatCurrency(branchAnalytics.averageVerifiedAmount)}</strong></div>
                <div class="analytics-card"><span>Remittance Completion</span><strong>${branchAnalytics.remittanceCompletionRate.toFixed(1)}%</strong></div>
              </div>
              <div class="charts">
                <div class="chart-card">
                  <h3>Top Branches by Verified Collection</h3>
                  ${buildCollectionBars(rankedBranches, branchAnalytics.maxVerifiedAmount) || '<p class="meta">No verified collections yet.</p>'}
                </div>
                <div class="chart-card">
                  <h3>Remittance Completion Rate</h3>
                  ${buildRemittanceBars(rankedBranches) || '<p class="meta">No remittance activity yet.</p>'}
                </div>
              </div>
              <h2>Branch Performance Ranking</h2>
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Branch</th>
                    <th>Verified Collections</th>
                    <th>Collection Share</th>
                    <th>Remittance Rate</th>
                    <th>Verified Count</th>
                  </tr>
                </thead>
                <tbody>${buildRankingRows(rankedBranches, branchAnalytics.totalVerifiedAmount)}</tbody>
              </table>
              <h2>Branch Collection Details</h2>
              <table>
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Payments</th>
                    <th>Verified Collections</th>
                    <th>Remitted To Main</th>
                    <th>Pending Remittance</th>
                    <th>Remitted By</th>
                    <th>Remitted Date</th>
                    <th>Verified By Main</th>
                    <th>Verified Date</th>
                    <th>Verified Count</th>
                  </tr>
                </thead>
                <tbody>${buildReportRows(branchSummaries)}</tbody>
              </table>
              <p class="footer">This document summarizes branch collections and remittance status recorded in WARDS.</p>
            </main>
          </div>
        </body>
      </html>
    `;
  };

  const handlePrintCollectionReport = () => {
    const reportWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!reportWindow) {
      setPageError('Allow pop-ups to print the Tax Collection Report.');
      return;
    }
    // Use safe DOM API instead of document.write to prevent XSS
    const reportHtml = buildCollectionReportHtml({ includeToolbar: true });
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    reportWindow.location.href = url;
    // Clean up blob URL after window loads
    reportWindow.onload = () => {
      URL.revokeObjectURL(url);
    };
  };

  const downloadCollectionSpreadsheet = () => {
    const rows = [
      [
        'Branch',
        'Payments',
        'Verified Collection',
        'Remitted To Main',
        'Pending Remittance',
        'Remitted By',
        'Remitted Date',
        'Verified By Main',
        'Verified Date',
        'Verified Count',
        'Pending Count',
        'Failed Count',
      ],
      ...branchSummaries.map((branch) => [
        branch.branch,
        branch.totalPayments,
        Number(branch.verifiedAmount || 0).toFixed(2),
        Number(branch.remittedAmount || 0).toFixed(2),
        Number(branch.pendingRemittanceAmount || 0).toFixed(2),
        branch.remittedBy || 'N/A',
        formatBranchRemittanceDate(branch.remittedAt),
        branch.verifiedBy || 'Pending Main Review',
        formatBranchRemittanceDate(branch.verifiedAt),
        branch.verifiedCount,
        branch.pendingCount,
        branch.failedCount,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `wards-tax-collection-${collectionMonthLabel.toLowerCase().replaceAll(' ', '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  };

  const openRemittanceActionModal = (remittance, action) => {
    setRemittanceActionError('');
    setSuccessMessage('');
    setPageError('');
    setRemittanceActionModal({ action, remittance });
  };

  const handleConfirmRemittanceAction = async () => {
    if (!remittanceActionModal.remittance || !remittanceActionModal.action) {
      return;
    }

    setRemittanceActionLoading(true);
    setRemittanceActionError('');
    setPageError('');
    setSuccessMessage('');

    try {
      await reviewRemittance(remittanceActionModal.remittance.id, remittanceActionModal.action);
      closeRemittanceActionModal();
    } catch (error) {
      setRemittanceActionError(error.message || 'Failed to review remittance.');
    } finally {
      setRemittanceActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#0f2f5f] border-t-transparent" />
          <p className="text-slate-600">Loading tax collection records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-[28px] bg-gradient-to-b from-slate-100 via-white to-slate-100 p-3 md:p-4">
      <WardsPageHero
        eyebrow={adminUser?.internal_role === 'superadmin' || adminUser?.role === 'superadmin' ? 'Superadmin Dashboard' : 'Main Admin Dashboard'}
        title={collectionReportTitle}
        subtitle="Monitor verified tax payments, branch collections, and remittances credited to the Main collection account."
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Month</span>
              <input
                type="month"
                min={currentMonthValue}
                max={currentMonthValue}
                value={selectedMonth}
                onChange={(event) => handleCollectionMonthChange(event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-[#0f2f5f] outline-none focus:border-[#0f2f5f]"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setPageError('');
                setSuccessMessage('');
                setShowCollectionReportModal(true);
              }}
              className="rounded-2xl border border-[#0f2f5f] bg-white px-5 py-3 text-sm font-semibold text-[#0f2f5f] shadow-sm transition hover:bg-slate-50"
            >
              View Tax Collection Report
            </button>
            <button
              type="button"
              onClick={downloadCollectionSpreadsheet}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100"
            >
              Download Spread sheet
            </button>
            <button
              type="button"
              onClick={fetchPayments}
              className="rounded-2xl bg-[#0f2f5f] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/10 transition hover:bg-[#19498d]"
            >
              Refresh
            </button>
          </div>
        )}
      />

      {pageError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {pageError}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-[#b9c9dd] bg-[#0f2f5f] text-white shadow-xl shadow-blue-950/10">
        <div className="grid gap-6 p-7 xl:grid-cols-[1.2fr,0.8fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-blue-100">Main Collection Account</p>
            <p className="mt-4 text-5xl font-black tracking-tight md:text-6xl">{formatCurrency(mainCollectionAmount)}</p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100">
              Accepted branch remittances for {collectionMonthLabel} are counted here. Pending remittances stay locked for review until Main accepts or rejects the batch.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">Pending Review</p>
              <p className="mt-2 text-2xl font-bold">{formatCurrency(pendingRemittanceAmount)}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">Accepted Remitted</p>
              <p className="mt-2 text-2xl font-bold">{formatCurrency(acceptedRemittanceAmount)}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">System Verified</p>
              <p className="mt-2 text-2xl font-bold">{formatCurrency(paymentStats.verifiedAmount)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ['Total Payments', paymentStats.totalPayments, `${collectionMonthLabel} payment records`],
          ['Pending Verification', paymentStats.pendingCount, 'Awaiting treasury action'],
          ['Verified Payments', paymentStats.verifiedCount, 'Confirmed collections'],
          ['Failed / Expired', paymentStats.failedCount, 'Excluded from collection totals'],
        ].map(([label, value, helper]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
            <p className="mt-1 text-sm text-slate-500">{helper}</p>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Branch Collections</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Collection by Branch</h2>
            <p className="mt-1 text-sm text-slate-600">Verified payment totals and remittance movement for {collectionMonthLabel}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPageError('');
                setSuccessMessage('');
                setShowCollectionReportModal(true);
              }}
              className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              View Tax Collection Report
            </button>
            <button
              type="button"
              onClick={downloadCollectionSpreadsheet}
              className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
            >
              Download Spread sheet
            </button>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 md:overflow-hidden">
          <table className="w-full table-auto divide-y divide-slate-200 text-xs min-w-[800px]">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-2 py-2.5">Branch</th>
                <th className="px-2 py-2.5">Pay</th>
                <th className="px-2 py-2.5 text-right">Verified</th>
                <th className="px-2 py-2.5 text-right">Remitted</th>
                <th className="px-2 py-2.5 text-right">Pending</th>
                <th className="px-2 py-2.5">By</th>
                <th className="px-2 py-2.5">Remit Date</th>
                <th className="px-2 py-2.5">Reviewer</th>
                <th className="px-2 py-2.5">Review Date</th>
                <th className="px-2 py-2.5">Mix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branchSummaries.map((branch) => (
                <tr key={branch.branch} className="hover:bg-slate-50">
                  <td className="px-2 py-2.5 text-[11px] font-bold text-[#0f2f5f]">{branch.branch}</td>
                  <td className="px-2 py-2.5 text-slate-700">{branch.totalPayments}</td>
                  <td className="px-2 py-2.5 text-right text-[11px] font-bold text-slate-950">{formatCurrency(branch.verifiedAmount)}</td>
                  <td className="px-2 py-2.5 text-right text-[11px] font-semibold text-emerald-700">{formatCurrency(branch.remittedAmount)}</td>
                  <td className="px-2 py-2.5 text-right text-[11px] font-semibold text-amber-700">{formatCurrency(branch.pendingRemittanceAmount)}</td>
                  <td className="px-2 py-2.5 text-[11px] text-slate-700">{branch.remittedBy || 'N/A'}</td>
                  <td className="px-2 py-2.5 text-[10px] text-slate-600">{formatBranchRemittanceDate(branch.remittedAt)}</td>
                  <td className="px-2 py-2.5 text-[11px] text-slate-700">{branch.verifiedBy || 'Pending'}</td>
                  <td className="px-2 py-2.5 text-[10px] text-slate-600">{formatBranchRemittanceDate(branch.verifiedAt)}</td>
                  <td className="px-2 py-2.5 text-[10px] text-slate-600">
                    {branch.verifiedCount}V / {branch.pendingCount}P / {branch.failedCount}F
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!branchSummaries.length ? (
            <div className="bg-white px-5 py-10 text-center text-sm text-slate-500">No branch collections available for {collectionMonthLabel}.</div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Payment Ledger</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Tax Payment Records</h2>
            <p className="mt-1 text-sm text-slate-600">Showing payment records for {collectionMonthLabel}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'All'],
              ['pending', 'Pending'],
              ['confirmed', 'Confirmed'],
              ['failed', 'Failed'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  filter === key ? 'bg-[#0f2f5f] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {groupedLedgerPayments.map(({ branchName, records }) => {
            const currentPage = ledgerPages[branchName] || 1;
            const totalPages = Math.ceil(records.length / LEDGER_PER_PAGE);
            const startIndex = (currentPage - 1) * LEDGER_PER_PAGE;
            const endIndex = startIndex + LEDGER_PER_PAGE;
            const pagedRecords = records.slice(startIndex, endIndex);
            return (
              <div key={branchName} className="overflow-x-auto rounded-2xl border border-slate-200 md:overflow-hidden">
                <div className="border-b border-slate-200 bg-[#0f2f5f] px-5 py-3 text-white">
                  <p className="text-xs font-black uppercase tracking-[0.22em]">{branchName}</p>
                </div>
                <div className="overflow-hidden">
                  <table className="w-full table-auto divide-y divide-slate-200 text-xs min-w-[700px]">
                    <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      <tr>
                        <th className="px-2 py-2.5">Txn ID</th>
                        <th className="px-2 py-2.5">Taxpayer</th>
                        <th className="px-2 py-2.5">Branch</th>
                        <th className="px-2 py-2.5 text-right">Amount</th>
                        <th className="px-2 py-2.5">Status</th>
                        <th className="px-2 py-2.5">Created</th>
                        <th className="px-2 py-2.5">Verified</th>
                        <th className="px-2 py-2.5">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedRecords.map((payment) => {
                        const status = normalizeStatus(payment.status);
                        return (
                          <tr key={payment.id} className="hover:bg-slate-50">
                            <td className="px-2 py-2.5 font-mono text-[10px] font-semibold text-slate-900">{payment.transaction_id || payment.ref_number || 'N/A'}</td>
                            <td className="px-2 py-2.5 text-[11px] font-semibold text-slate-900">{payment.taxpayer_name || 'N/A'}</td>
                            <td className="px-2 py-2.5 text-[11px] text-slate-600">{branchName}</td>
                            <td className="px-2 py-2.5 text-right text-[11px] font-bold text-slate-950">{formatCurrency(payment.amount)}</td>
                            <td className="px-2 py-2.5">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyles[status] || statusStyles.failed}`}>
                                {getStatusLabel(payment.status)}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-slate-500">
                              <div className="text-[11px] font-medium text-slate-700">
                                {formatPaymentDate(payment.created_at, { year: 'numeric', month: 'short', day: 'numeric' })}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {formatPaymentDate(payment.created_at, { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-slate-500">
                              {payment.verified_at ? (
                                <>
                                  <div className="text-[11px] font-medium text-slate-700">
                                    {formatPaymentDate(payment.verified_at, { year: 'numeric', month: 'short', day: 'numeric' })}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {formatPaymentDate(payment.verified_at, { hour: '2-digit', minute: '2-digit', hour12: true })}
                                  </div>
                                </>
                              ) : (
                                'N/A'
                              )}
                            </td>
                            <td className="px-2 py-2.5">
                              {status === 'pending' ? (
                                <button
                                  type="button"
                                  onClick={() => handleVerifyPayment(payment.id)}
                                  className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-700"
                                >
                                  Verify
                                </button>
                              ) : (
                                <span className="text-[10px] font-semibold text-slate-400">Recorded</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {Array.from({ length: LEDGER_PER_PAGE - pagedRecords.length }).map((_, i) => (
                        <tr key={`empty-${i}`} className="h-[43px]">
                          <td colSpan="8" className="px-2 py-2.5">&nbsp;</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[11px] font-semibold text-slate-600">
                    <span>{startIndex + 1}-{Math.min(endIndex, records.length)} of {records.length}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={currentPage === 1}
                        onClick={() => setLedgerPages((prev) => ({ ...prev, [branchName]: currentPage - 1 }))}
                        className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setLedgerPages((prev) => ({ ...prev, [branchName]: page }))}
                          className={`rounded-md px-2 py-1 text-[10px] font-bold transition ${
                            page === currentPage
                              ? 'bg-[#0f2f5f] text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={currentPage === totalPages}
                        onClick={() => setLedgerPages((prev) => ({ ...prev, [branchName]: currentPage + 1 }))}
                        className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!filteredPayments.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">No payments match the selected filter for {collectionMonthLabel}.</div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Remittance Control</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Main Collection And Remittance Review</h2>
            <p className="mt-1 text-sm text-slate-600">Review {collectionMonthLabel} branch remittance batches before they are counted in Main collections.</p>
          </div>
          <button
            type="button"
            onClick={fetchRemittances}
            className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Refresh Remittances
          </button>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 md:overflow-hidden">
          <table className="w-full table-auto divide-y divide-slate-200 text-xs min-w-[700px]">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-2 py-2.5">Remit No.</th>
                <th className="px-2 py-2.5">Branch</th>
                <th className="px-2 py-2.5">Pay</th>
                <th className="px-2 py-2.5 text-right">Amount</th>
                <th className="px-2 py-2.5">Report</th>
                <th className="px-2 py-2.5">Status</th>
                <th className="px-2 py-2.5">Submitted</th>
                <th className="px-2 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendingReviewRemittances.map((remittance) => (
                <tr key={remittance.id} className="hover:bg-slate-50">
                  <td className="px-2 py-2.5 font-mono text-[10px] font-semibold text-slate-900">{remittance.remittance_number}</td>
                  <td className="px-2 py-2.5 text-[11px] font-semibold text-slate-700">{branchLookup[remittance.branch_id] || formatBranchLabel(remittance.branch_name, remittance.branch_id)}</td>
                  <td className="px-2 py-2.5 text-slate-600">{remittance.payment_count}</td>
                  <td className="px-2 py-2.5 text-right text-[11px] font-bold text-slate-950">{formatCurrency(remittance.total_amount)}</td>
                  <td className="px-2 py-2.5">
                    {remittance.report_file_name ? (
                      <button
                        type="button"
                        onClick={() => downloadRemittanceReport(remittance)}
                        className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100"
                      >
                        DL
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                      {remittance.status}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-[10px] text-slate-500">
                    {formatPaymentDate(remittance.submitted_at, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => openRemittanceActionModal(remittance, 'accept')}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-700"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => openRemittanceActionModal(remittance, 'reject')}
                        className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-rose-700"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pendingReviewRemittances.length ? (
            <div className="bg-white px-5 py-10 text-center text-sm text-slate-500">No branch remittances submitted for {collectionMonthLabel}.</div>
          ) : null}
        </div>
      </section>

      <RemittanceActionModal
        open={Boolean(remittanceActionModal.remittance && remittanceActionModal.action)}
        title={remittanceActionModal.action === 'accept' ? 'Accept this remittance batch?' : 'Delete this remittance batch from review?'}
        message={remittanceActionModal.action === 'accept'
          ? 'Accepting this remittance adds the batch to the Main collection account and marks the review as complete.'
          : 'Deleting this remittance from the Main review queue will reject the batch and return it to the branch workflow.'}
        details={[
          { label: 'Remittance No.', value: remittanceActionModal.remittance?.remittance_number || 'N/A' },
          { label: 'Branch', value: remittanceActionModal.remittance ? (branchLookup[remittanceActionModal.remittance.branch_id] || formatBranchLabel(remittanceActionModal.remittance.branch_name, remittanceActionModal.remittance.branch_id)) : 'N/A' },
          { label: 'Payments', value: remittanceActionModal.remittance?.payment_count || '0' },
          { label: 'Amount', value: formatCurrency(remittanceActionModal.remittance?.total_amount) },
        ]}
        confirmLabel={remittanceActionModal.action === 'accept' ? 'Yes, Accept' : 'Yes, Delete'}
        loadingLabel={remittanceActionModal.action === 'accept' ? 'Accepting...' : 'Deleting...'}
        isLoading={remittanceActionLoading}
        errorMessage={remittanceActionError}
        confirmClassName={remittanceActionModal.action === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
        onConfirm={handleConfirmRemittanceAction}
        onCancel={closeRemittanceActionModal}
      />

      {showCollectionReportModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tax Collection Report</p>
                <h2 className="mt-1 text-2xl font-bold text-primary">{collectionReportTitle}</h2>
                <p className="mt-1 text-sm text-slate-500">Review the report inside this modal. Scroll if content overflows, then print when ready.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handlePrintCollectionReport}
                  className="rounded-2xl bg-[#0f2f5f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#19498d]"
                >
                  Print Report
                </button>
                <button
                  type="button"
                  onClick={() => setShowCollectionReportModal(false)}
                  className="rounded-2xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <CollectionReportView
                title={collectionReportTitle}
                generatedAt={new Date().toLocaleString('en-PH', { timeZone: PAYMENT_TIME_ZONE })}
                mainCollectionAmount={mainCollectionAmount}
                verifiedAmount={paymentStats.verifiedAmount}
                pendingRemittanceAmount={pendingRemittanceAmount}
                branchAnalytics={branchAnalytics}
                rankedBranches={rankedBranches}
                branchSummaries={branchSummaries}
              />
            </div>
          </div>
        </div>
      ) : null}

      <SystemMessageModal
        open={Boolean(messageModal)}
        tone={messageModal?.tone}
        title={messageModal?.title}
        message={messageModal?.message}
        onClose={() => setMessageModal(null)}
      />
    </div>
  );
};

export default PaymentManagement;
