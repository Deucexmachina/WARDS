import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { authAPI, rptPaymentAPI } from '../services/api'

function formatCurrency(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(Number(value || 0))
}

function RPTValidationQueue() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [remarks, setRemarks] = useState({})
  const [releaseForms, setReleaseForms] = useState({})
  const [message, setMessage] = useState('')
  const [branches, setBranches] = useState([])

  const token = localStorage.getItem('token')

  const filteredTransactions = useMemo(() => transactions, [transactions])

  useEffect(() => {
    const bootstrap = async () => {
      if (!token) {
        navigate('/login')
        return
      }

      try {
        const [authResponse, branchResponse] = await Promise.all([
          authAPI.verify(token),
          rptPaymentAPI.getBranches(),
        ])
        setUser(authResponse.data.user)
        setBranches(branchResponse.data)
        await fetchQueue(authResponse.data.user, '')
      } catch (err) {
        console.error(err)
        localStorage.removeItem('token')
        navigate('/login')
      } finally {
        setLoading(false)
      }
    }

    bootstrap()
  }, [navigate, token])

  const fetchQueue = async (resolvedUser = user, nextStatus = selectedStatus, nextBranch = selectedBranch) => {
    try {
      const response = await rptPaymentAPI.getValidationQueue(token, {
        status: nextStatus || undefined,
        branch_id: nextBranch || undefined,
      })
      setTransactions(response.data)
      if (resolvedUser) {
        setUser(resolvedUser)
      }
    } catch (err) {
      console.error(err)
      setMessage(err.response?.data?.detail || 'Unable to load the Branch Payment Validation Queue.')
    }
  }

  const submitDecision = async (transactionId, action) => {
    setSaving(true)
    setMessage('')
    try {
      await rptPaymentAPI.submitDecision(token, transactionId, {
        action,
        remarks: remarks[transactionId] || '',
      })
      setMessage(`Transaction updated via ${action}.`)
      fetchQueue()
    } catch (err) {
      console.error(err)
      setMessage(err.response?.data?.detail || 'Unable to update the transaction decision.')
    } finally {
      setSaving(false)
    }
  }

  const issueOfficialReceipt = async (transactionId) => {
    setSaving(true)
    setMessage('')
    try {
      await rptPaymentAPI.issueOfficialReceipt(token, transactionId)
      setMessage('Computerized Official Receipt generated successfully.')
      fetchQueue()
    } catch (err) {
      console.error(err)
      setMessage(err.response?.data?.detail || 'Unable to generate the Official Receipt.')
    } finally {
      setSaving(false)
    }
  }

  const releaseOfficialReceipt = async (transactionId) => {
    const form = releaseForms[transactionId] || { release_method: 'DOWNLOAD' }
    setSaving(true)
    setMessage('')
    try {
      await rptPaymentAPI.releaseOfficialReceipt(token, transactionId, form)
      setMessage('Official Receipt released and transaction completed.')
      fetchQueue()
    } catch (err) {
      console.error(err)
      setMessage(err.response?.data?.detail || 'Unable to release the Official Receipt.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-14 w-14 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Loading Branch Payment Validation Queue...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="rounded-3xl bg-slate-900 text-white p-8 shadow-lg">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-cyan-200">Treasury Validation</p>
              <h1 className="mt-2 text-3xl font-bold">Branch Payment Validation Queue</h1>
              <p className="mt-3 max-w-3xl text-slate-200">
                Review RPT PayMongo submissions, uploaded payment proof, taxpayer details, and transaction logs before approving, rejecting, or requesting clarification.
              </p>
            </div>
            <button
              onClick={() => navigate('/admin')}
              className="rounded-2xl border border-white/20 px-5 py-3 font-semibold text-white hover:bg-white/10"
            >
              Back to Admin Modules
            </button>
          </div>
        </div>

        <div className="card rounded-3xl shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:w-[520px]">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Branch Filter</label>
                <select
                  value={selectedBranch}
                  onChange={(e) => {
                    setSelectedBranch(e.target.value)
                    fetchQueue(user, selectedStatus, e.target.value)
                  }}
                  className="input-field"
                >
                  <option value="">All branches</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status Filter</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => {
                    setSelectedStatus(e.target.value)
                    fetchQueue(user, e.target.value, selectedBranch)
                  }}
                  className="input-field"
                >
                  <option value="">All statuses</option>
                  <option value="PAYMENT_SUBMITTED">Payment Submitted</option>
                  <option value="PENDING_TREASURY_VALIDATION">Pending Treasury Validation</option>
                  <option value="PAYMENT_VERIFIED">Payment Verified</option>
                  <option value="PAYMENT_REJECTED">Payment Rejected</option>
                  <option value="CLARIFICATION_REQUESTED">Clarification Requested</option>
                  <option value="OR_GENERATED">OR Generated</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
            </div>
            <div className="rounded-2xl bg-slate-100 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Signed in as</p>
              <p className="text-lg font-bold text-slate-800">{user?.full_name}</p>
              <p className="text-sm text-slate-600">{user?.role}</p>
            </div>
          </div>

          {message && (
            <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
              {message}
            </div>
          )}
        </div>

        <div className="space-y-5">
          {filteredTransactions.length === 0 ? (
            <div className="card rounded-3xl shadow-lg text-center text-gray-500 py-10">
              No RPT payment transactions match the selected filters.
            </div>
          ) : (
            filteredTransactions.map((transaction) => {
              const releaseForm = releaseForms[transaction.id] || { release_method: 'DOWNLOAD' }
              const canTreasuryDecide = ['PAYMENT_SUBMITTED', 'PENDING_TREASURY_VALIDATION', 'CLARIFICATION_REQUESTED'].includes(transaction.status)
              const canIssueOr = user?.role === 'admin' && transaction.status === 'PAYMENT_VERIFIED'
              const canRelease = user?.role === 'admin' && transaction.status === 'OR_GENERATED'

              return (
                <div key={transaction.id} className="card rounded-3xl shadow-lg">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-blue-700">{transaction.branch_name}</p>
                      <h2 className="mt-2 text-2xl font-bold text-gray-800">{transaction.wards_transaction_no}</h2>
                      <p className="text-gray-600 mt-1">{transaction.taxpayer_name} â€¢ {transaction.taxpayer_email}</p>
                      <p className="text-gray-600 mt-1">Status: <span className="font-semibold">{transaction.status.replaceAll('_', ' ')}</span></p>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-5 py-4">
                      <p className="text-sm text-slate-500">Total Paid</p>
                      <p className="text-2xl font-bold text-slate-900">{formatCurrency(transaction.total_amount)}</p>
                      <p className="text-xs text-slate-500 mt-2">PayMongo: {transaction.proof_reference || transaction.paymongo_reference_id || 'Pending'}</p>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <h3 className="font-semibold text-slate-900 mb-3">Covered Property Records</h3>
                        <div className="space-y-3">
                          {transaction.items.map((item) => (
                            <div key={`${transaction.id}-${item.tdn}`} className="rounded-2xl bg-white p-4 shadow-sm">
                              <p className="font-semibold text-blue-700">{item.tdn}</p>
                              <p className="text-sm text-slate-600 mt-1">{item.property_address}</p>
                              <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                                <div><span className="text-slate-500">Basic</span><p className="font-semibold">{formatCurrency(item.basic_tax_due)}</p></div>
                                <div><span className="text-slate-500">SEF</span><p className="font-semibold">{formatCurrency(item.sef_tax)}</p></div>
                                <div><span className="text-slate-500">Penalties</span><p className="font-semibold">{formatCurrency(item.penalties)}</p></div>
                                <div><span className="text-slate-500">Discounts</span><p className="font-semibold">{formatCurrency(item.discounts)}</p></div>
                                <div><span className="text-slate-500">Amount Due</span><p className="font-semibold">{formatCurrency(item.total_amount)}</p></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-4">
                        <h3 className="font-semibold text-slate-900 mb-3">Transaction Logs</h3>
                        <div className="space-y-3">
                          {transaction.logs.map((log, index) => (
                            <div key={`${transaction.id}-log-${index}`} className="rounded-2xl bg-white p-3 shadow-sm">
                              <p className="text-sm font-semibold text-slate-900">{log.status.replaceAll('_', ' ')}</p>
                              <p className="text-sm text-slate-600 mt-1">{log.message}</p>
                              <p className="text-xs text-slate-400 mt-1">{log.actor}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <h3 className="font-semibold text-slate-900 mb-3">Proof and Receipt Files</h3>
                        <div className="space-y-2 text-sm">
                          {transaction.proofs.length > 0 ? (
                            transaction.proofs.map((proof, index) => (
                              <p key={`${transaction.id}-proof-${index}`}>
                                <a
                                  href={`http://localhost:8000/${proof.file_path}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary-700 font-semibold hover:underline"
                                >
                                  View Uploaded Proof: {proof.original_filename}
                                </a>
                              </p>
                            ))
                          ) : (
                            <p className="text-slate-500">No payment proof uploaded yet.</p>
                          )}

                          {transaction.official_receipt_pdf_path && (
                            <p>
                              <a
                                href={`http://localhost:8000/${transaction.official_receipt_pdf_path}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary-700 font-semibold hover:underline"
                              >
                                Download Official Receipt PDF
                              </a>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 p-4">
                        <h3 className="font-semibold text-slate-900 mb-3">Remarks / Clarification</h3>
                        <textarea
                          value={remarks[transaction.id] || ''}
                          onChange={(e) => setRemarks((current) => ({ ...current, [transaction.id]: e.target.value }))}
                          className="input-field min-h-28"
                          placeholder="Add treasury remarks, rejection reason, or clarification notes"
                        />
                      </div>

                      {canTreasuryDecide && (
                        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
                          <button
                            type="button"
                            onClick={() => submitDecision(transaction.id, 'approve')}
                            disabled={saving}
                            className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Approve Payment
                          </button>
                          <button
                            type="button"
                            onClick={() => submitDecision(transaction.id, 'clarify')}
                            disabled={saving}
                            className="w-full rounded-2xl bg-amber-500 px-4 py-3 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
                          >
                            Request Clarification
                          </button>
                          <button
                            type="button"
                            onClick={() => submitDecision(transaction.id, 'reject')}
                            disabled={saving}
                            className="w-full rounded-2xl bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            Reject Payment
                          </button>
                        </div>
                      )}

                      {canIssueOr && (
                        <button
                          type="button"
                          onClick={() => issueOfficialReceipt(transaction.id)}
                          disabled={saving}
                          className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          Generate Computerized Official Receipt
                        </button>
                      )}

                      {canRelease && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                          <p className="font-semibold text-slate-900">Receipt Release</p>
                          <select
                            value={releaseForm.release_method}
                            onChange={(e) => setReleaseForms((current) => ({
                              ...current,
                              [transaction.id]: {
                                ...releaseForm,
                                release_method: e.target.value,
                              },
                            }))}
                            className="input-field"
                          >
                            <option value="DOWNLOAD">Download</option>
                            <option value="EMAIL">Email</option>
                            <option value="BRANCH_PICKUP">Branch Pickup</option>
                            <option value="COURIER">Courier</option>
                          </select>

                          {releaseForm.release_method === 'EMAIL' && (
                            <input
                              type="email"
                              value={releaseForm.release_email || ''}
                              onChange={(e) => setReleaseForms((current) => ({
                                ...current,
                                [transaction.id]: {
                                  ...releaseForm,
                                  release_email: e.target.value,
                                },
                              }))}
                              className="input-field"
                              placeholder="Recipient email"
                            />
                          )}

                          {releaseForm.release_method === 'COURIER' && (
                            <>
                              <input
                                type="text"
                                value={releaseForm.courier_name || ''}
                                onChange={(e) => setReleaseForms((current) => ({
                                  ...current,
                                  [transaction.id]: {
                                    ...releaseForm,
                                    courier_name: e.target.value,
                                  },
                                }))}
                                className="input-field"
                                placeholder="Courier name"
                              />
                              <input
                                type="text"
                                value={releaseForm.courier_tracking_number || ''}
                                onChange={(e) => setReleaseForms((current) => ({
                                  ...current,
                                  [transaction.id]: {
                                    ...releaseForm,
                                    courier_tracking_number: e.target.value,
                                  },
                                }))}
                                className="input-field"
                                placeholder="Tracking number"
                              />
                              <textarea
                                value={releaseForm.courier_rider_details || ''}
                                onChange={(e) => setReleaseForms((current) => ({
                                  ...current,
                                  [transaction.id]: {
                                    ...releaseForm,
                                    courier_rider_details: e.target.value,
                                  },
                                }))}
                                className="input-field min-h-24"
                                placeholder="Rider or agent details"
                              />
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => releaseOfficialReceipt(transaction.id)}
                            disabled={saving}
                            className="w-full rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Complete Receipt Release
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default RPTValidationQueue
