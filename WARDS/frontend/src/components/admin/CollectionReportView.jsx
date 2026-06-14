/**
 * CollectionReportView
 *
 * Renders the Tax Collection Report as React DOM inside the app.
 * Replaces the previous iframe/blob preview to eliminate a browser
 * execution surface. Used for preview only; printing still uses the
 * standalone HTML template via handlePrintCollectionReport.
 *
 * Security: all interpolated strings are escaped via React’s built-in
 * auto-escaping (no dangerouslySetInnerHTML). Numeric values are
 * formatted before display.
 */

const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const formatBranchRemittanceDate = (value) => {
  if (!value) return 'N/A';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return 'N/A';
  return parsedDate.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const ProgressBar = ({ widthPct, variant = 'blue' }) => (
  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
    <div
      className={`h-full rounded-full ${variant === 'green' ? 'bg-emerald-600' : 'bg-[#0f2f5f]'}`}
      style={{ width: `${widthPct}%` }}
    />
  </div>
);

const CollectionReportView = ({
  title,
  generatedAt,
  mainCollectionAmount,
  verifiedAmount,
  pendingRemittanceAmount,
  branchAnalytics,
  rankedBranches,
  branchSummaries,
}) => {
  const safeDate = generatedAt || new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });

  return (
    <div className="h-full overflow-auto bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        {/* Header */}
        <div className="mb-6 border-b-2 border-[#123a70] pb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">WARDS Main Admin</p>
          <h1 className="mt-1 text-3xl font-bold text-[#0f2f5f]">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">Generated {safeDate}</p>
        </div>

        {/* KPIs */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Main Collection Account</span>
            <strong className="mt-2 block text-xl text-[#0f2f5f]">{formatCurrency(mainCollectionAmount)}</strong>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Verified System Collections</span>
            <strong className="mt-2 block text-xl text-[#0f2f5f]">{formatCurrency(verifiedAmount)}</strong>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Pending Remittance</span>
            <strong className="mt-2 block text-xl text-[#0f2f5f]">{formatCurrency(pendingRemittanceAmount)}</strong>
          </div>
        </div>

        {/* Analytics */}
        <h2 className="mb-3 text-lg font-bold text-[#0f2f5f]">Collection Performance Analytics</h2>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Top Branch</span>
            <strong className="mt-1 block text-sm font-semibold text-slate-800">{branchAnalytics.leadingBranch?.branch || 'N/A'}</strong>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Top Collection</span>
            <strong className="mt-1 block text-sm font-semibold text-slate-800">{formatCurrency(branchAnalytics.leadingBranch?.verifiedAmount || 0)}</strong>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Average Branch Collection</span>
            <strong className="mt-1 block text-sm font-semibold text-slate-800">{formatCurrency(branchAnalytics.averageVerifiedAmount)}</strong>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">Remittance Completion</span>
            <strong className="mt-1 block text-sm font-semibold text-slate-800">{branchAnalytics.remittanceCompletionRate.toFixed(1)}%</strong>
          </div>
        </div>

        {/* Charts */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-bold text-[#0f2f5f]">Top Branches by Verified Collection</h3>
            {rankedBranches.length === 0 ? (
              <p className="text-sm text-slate-500">No verified collections yet.</p>
            ) : (
              <div className="space-y-2">
                {rankedBranches.slice(0, 8).map((branch, index) => {
                  const width = branchAnalytics.maxVerifiedAmount > 0
                    ? Math.max(4, (branch.verifiedAmount / branchAnalytics.maxVerifiedAmount) * 100)
                    : 0;
                  return (
                    <div key={index} className="grid grid-cols-[1fr_3fr_auto] items-center gap-2">
                      <span className="truncate text-xs font-bold text-slate-700">
                        #{index + 1} {branch.branch}
                      </span>
                      <ProgressBar widthPct={width} />
                      <span className="text-right text-xs font-bold text-slate-600">{formatCurrency(branch.verifiedAmount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-bold text-[#0f2f5f]">Remittance Completion Rate</h3>
            {rankedBranches.length === 0 ? (
              <p className="text-sm text-slate-500">No remittance activity yet.</p>
            ) : (
              <div className="space-y-2">
                {rankedBranches.slice(0, 8).map((branch, index) => {
                  const remittanceBase = branch.remittedAmount + branch.pendingRemittanceAmount;
                  const width = remittanceBase > 0 ? (branch.remittedAmount / remittanceBase) * 100 : 0;
                  return (
                    <div key={index} className="grid grid-cols-[1fr_3fr_auto] items-center gap-2">
                      <span className="truncate text-xs font-bold text-slate-700">{branch.branch}</span>
                      <ProgressBar widthPct={width} variant="green" />
                      <span className="text-right text-xs font-bold text-slate-600">{width.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Ranking Table */}
        <h2 className="mb-3 text-lg font-bold text-[#0f2f5f]">Branch Performance Ranking</h2>
        <div className="mb-6 rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-600">
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Rank</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Branch</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Verified Collections</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Collection Share</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Remittance Rate</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Verified Count</th>
              </tr>
            </thead>
            <tbody>
              {rankedBranches.map((branch, index) => {
                const collectionShare = branchAnalytics.totalVerifiedAmount > 0
                  ? (branch.verifiedAmount / branchAnalytics.totalVerifiedAmount) * 100
                  : 0;
                const remittanceBase = branch.remittedAmount + branch.pendingRemittanceAmount;
                const remittanceRate = remittanceBase > 0 ? (branch.remittedAmount / remittanceBase) * 100 : 0;
                return (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-extrabold text-[#0f2f5f]">#{index + 1}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{branch.branch}</td>
                    <td className="px-3 py-2 text-slate-600">{formatCurrency(branch.verifiedAmount)}</td>
                    <td className="px-3 py-2 text-slate-600">{collectionShare.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-600">{remittanceRate.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-600">{branch.verifiedCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Details Table */}
        <h2 className="mb-3 text-lg font-bold text-[#0f2f5f]">Branch Collection Details</h2>
        <div className="mb-4 rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-600">
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Branch</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Payments</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Verified Collections</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Remitted To Main</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Pending Remittance</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Remitted By</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Remitted Date</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Verified By Main</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Verified Date</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Verified Count</th>
              </tr>
            </thead>
            <tbody>
              {branchSummaries.map((branch, index) => (
                <tr key={index} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-700">{branch.branch}</td>
                  <td className="px-3 py-2 text-slate-600">{branch.totalPayments}</td>
                  <td className="px-3 py-2 text-slate-600">{formatCurrency(branch.verifiedAmount)}</td>
                  <td className="px-3 py-2 text-slate-600">{formatCurrency(branch.remittedAmount)}</td>
                  <td className="px-3 py-2 text-slate-600">{formatCurrency(branch.pendingRemittanceAmount)}</td>
                  <td className="px-3 py-2 text-slate-600">{branch.remittedBy || 'N/A'}</td>
                  <td className="px-3 py-2 text-slate-600">{formatBranchRemittanceDate(branch.remittedAt)}</td>
                  <td className="px-3 py-2 text-slate-600">{branch.verifiedBy || 'Pending Main Review'}</td>
                  <td className="px-3 py-2 text-slate-600">{formatBranchRemittanceDate(branch.verifiedAt)}</td>
                  <td className="px-3 py-2 text-slate-600">{branch.verifiedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500">
          This document summarizes branch collections and remittance status recorded in WARDS.
        </p>
      </div>
    </div>
  );
};

export default CollectionReportView;
