import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { rptPaymentAPI, taxpayerPortalAPI } from '../services/api'

const PAYMENT_METHOD_OPTIONS = [
  { code: 'GCASH', label: 'GCash', detail: 'Pay via PayMongo sandbox wallet flow' },
  { code: 'MAYA', label: 'Maya', detail: 'Pay via Maya / PayMaya test checkout' },
  { code: 'CARD', label: 'Debit / Credit Card', detail: 'Hosted card checkout on PayMongo' },
  { code: 'ONLINE_BANKING', label: 'Online Banking', detail: 'Direct online banking via PayMongo' },
]

function formatCurrency(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(Number(value || 0))
}

function RPTOnlinePayment() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [taxpayer, setTaxpayer] = useState(null)
  const [branches, setBranches] = useState([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [tdn, setTdn] = useState('')
  const [captchaChecked, setCaptchaChecked] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResult, setSearchResult] = useState(null)
  const [searchStats, setSearchStats] = useState({ searches_remaining: 50, search_limit: 50 })
  const [cart, setCart] = useState([])
  const [selectedMethod, setSelectedMethod] = useState('GCASH')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [latestCheckout, setLatestCheckout] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [uploadingProofFor, setUploadingProofFor] = useState(null)
  const [proofFiles, setProofFiles] = useState({})
  const [proofReferences, setProofReferences] = useState({})
  const [bannerMessage, setBannerMessage] = useState('')

  const taxpayerToken = localStorage.getItem('taxpayerToken')

  const totalPayable = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.final_total_amount_due || 0), 0),
    [cart],
  )

  useEffect(() => {
    const bootstrap = async () => {
      if (!taxpayerToken) {
        setAuthError('Taxpayer authentication is required before using the RPT online payment module.')
        setLoading(false)
        return
      }

      try {
        const [meResponse, branchResponse, transactionResponse] = await Promise.all([
          taxpayerPortalAPI.me(taxpayerToken),
          rptPaymentAPI.getBranches(),
          rptPaymentAPI.getMyTransactions(taxpayerToken),
        ])
        setTaxpayer(meResponse.data)
        setBranches(branchResponse.data)
        setTransactions(transactionResponse.data)
        setAuthError('')
      } catch (err) {
        console.error(err)
        localStorage.removeItem('taxpayerToken')
        localStorage.removeItem('taxpayerUser')
        setAuthError('Your taxpayer portal session has expired. Please sign in again.')
      } finally {
        setLoading(false)
      }
    }

    bootstrap()
  }, [taxpayerToken])

  useEffect(() => {
    const status = searchParams.get('status')
    if (status === 'success') {
      setBannerMessage('PayMongo redirected back with a successful checkout result. Please upload your payment proof so the Branch Treasury Office can validate the transaction.')
      refreshTransactions()
    } else if (status === 'cancelled') {
      setBannerMessage('The PayMongo checkout was cancelled. You may review the summary and try again.')
    }
  }, [searchParams])

  const refreshTransactions = async () => {
    if (!taxpayerToken) {
      return
    }
    try {
      const response = await rptPaymentAPI.getMyTransactions(taxpayerToken)
      setTransactions(response.data)
    } catch (err) {
      console.error(err)
    }
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!selectedBranch) {
      setSearchMessage('Select a branch before searching for a TDN.')
      return
    }
    if (!captchaChecked) {
      setSearchMessage('Please complete the reCAPTCHA validation step before searching.')
      return
    }

    setSearchLoading(true)
    setSearchMessage('')
    setSearchResult(null)

    try {
      const response = await rptPaymentAPI.searchProperty(taxpayerToken, {
        branch_id: Number(selectedBranch),
        tdn,
        recaptcha_token: captchaChecked ? 'demo-recaptcha-passed' : '',
      })
      setSearchResult(response.data.property)
      setSearchMessage(response.data.message || '')
      setSearchStats({
        searches_remaining: response.data.searches_remaining,
        search_limit: response.data.search_limit,
      })
    } catch (err) {
      console.error(err)
      setSearchMessage(err.response?.data?.detail || 'Unable to search the selected branch TDN database.')
    } finally {
      setSearchLoading(false)
    }
  }

  const addToCart = () => {
    if (!searchResult) {
      return
    }
    if (cart.some((item) => item.property_id === searchResult.property_id)) {
      setSearchMessage('This TDN is already in your cart.')
      return
    }

    setCart((current) => [...current, searchResult])
    setSearchMessage('Property added to cart.')
  }

  const removeFromCart = (propertyId) => {
    setCart((current) => current.filter((item) => item.property_id !== propertyId))
  }

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setSearchMessage('Add at least one property record to your cart before payment.')
      return
    }

    const confirmed = window.confirm('Please verify the total amount to be paid.')
    if (!confirmed) {
      return
    }

    setCheckoutLoading(true)
    try {
      const response = await rptPaymentAPI.createCheckout(taxpayerToken, {
        branch_id: Number(selectedBranch || cart[0]?.branch_id),
        items: cart.map((item) => ({ property_id: item.property_id })),
        payment_method: selectedMethod,
        success_url: 'http://localhost:5173/rpt-payment?status=success',
        cancel_url: 'http://localhost:5173/rpt-payment?status=cancelled',
      })
      setLatestCheckout(response.data)
      setCart([])
      setSearchResult(null)
      setBannerMessage('PayMongo sandbox checkout session created. Continue to the hosted checkout page.')
      refreshTransactions()
    } catch (err) {
      console.error(err)
      setSearchMessage(err.response?.data?.detail || 'Unable to create the PayMongo checkout session.')
    } finally {
      setCheckoutLoading(false)
    }
  }

  const handleProofSubmit = async (transactionId) => {
    const file = proofFiles[transactionId]
    const reference = proofReferences[transactionId] || ''
    if (!file) {
      setBannerMessage('Please attach a JPG, PNG, or PDF proof file first.')
      return
    }
    if (!reference.trim()) {
      setBannerMessage('Please provide the PayMongo receipt/reference number.')
      return
    }

    setUploadingProofFor(transactionId)
    try {
      const formData = new FormData()
      formData.append('paymongo_reference', reference)
      formData.append('file', file)
      await rptPaymentAPI.uploadProof(taxpayerToken, transactionId, formData)
      setBannerMessage('Payment proof uploaded successfully. The transaction is now waiting for Branch Treasury validation.')
      setProofFiles((current) => ({ ...current, [transactionId]: null }))
      refreshTransactions()
    } catch (err) {
      console.error(err)
      setBannerMessage(err.response?.data?.detail || 'Unable to upload the payment proof.')
    } finally {
      setUploadingProofFor(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-10 text-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-gray-600">Loading the RPT online payment portal...</p>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="card border-l-4 border-red-500">
          <h1 className="text-3xl font-bold text-gray-800 mb-3">RPT Online Payment</h1>
          <p className="text-gray-700">{authError}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-xl font-bold text-gray-800 mb-3">Existing Taxpayer Account</h2>
            <p className="text-gray-600 mb-4">Sign in to continue with branch selection, TDN lookup, and PayMongo sandbox checkout.</p>
            <Link to="/taxpayer-login" className="btn-primary inline-block">
              Taxpayer Login
            </Link>
          </div>
          <div className="card">
            <h2 className="text-xl font-bold text-gray-800 mb-3">New Taxpayer</h2>
            <p className="text-gray-600 mb-4">Create your portal account first using email OTP verification.</p>
            <Link to="/taxpayer-signup" className="btn-secondary inline-block">
              Create Taxpayer Account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <section className="rounded-3xl bg-gradient-to-br from-slate-900 via-blue-900 to-cyan-700 p-8 text-white shadow-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-200">WARDS Public Portal</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight">Real Property Tax Online Payment</h1>
            <p className="mt-4 text-lg text-blue-100">
              Treasury-assisted online payment and validation workflow for Real Property Tax. Final payment validation and Official Receipt issuance remain under the authority of the Branch Treasury Office.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-5 py-4 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Signed in as</p>
            <p className="mt-2 text-xl font-semibold">{taxpayer?.full_name}</p>
            <p className="text-sm text-blue-100">{taxpayer?.email}</p>
          </div>
        </div>
      </section>

      {bannerMessage && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-900">
          {bannerMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-8">
        <div className="space-y-8">
          <section className="card rounded-3xl shadow-lg">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-blue-700">Step 1 to 4</p>
                <h2 className="text-2xl font-bold text-gray-800">Branch Selection, TDN Search, and Tax Computation</h2>
              </div>
              <div className="rounded-2xl bg-slate-100 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Daily Search Limit</p>
                <p className="text-lg font-bold text-slate-800">
                  {searchStats.searches_remaining} / {searchStats.search_limit} remaining
                </p>
              </div>
            </div>

            <form onSubmit={handleSearch} className="space-y-5">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Branch Office</label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="input-field"
                  required
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Tax Declaration Number (TDN)</label>
                <input
                  type="text"
                  value={tdn}
                  onChange={(e) => setTdn(e.target.value.toUpperCase())}
                  className="input-field"
                  placeholder="Example: G-006-00157"
                  required
                />
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={captchaChecked}
                  onChange={(e) => setCaptchaChecked(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-slate-700">
                  I confirm this search is valid and pass the demo reCAPTCHA validation gate for the taxpayer portal.
                </span>
              </label>

              <button
                type="submit"
                disabled={searchLoading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {searchLoading ? 'Searching Branch TDN Database...' : 'Search Selected Branch'}
              </button>
            </form>

            {searchMessage && (
              <div className={`mt-6 rounded-2xl px-4 py-3 text-sm ${
                searchResult ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
              }`}>
                {searchMessage}
              </div>
            )}

            {searchResult && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Property Found</p>
                    <h3 className="mt-2 text-2xl font-bold text-slate-900">{searchResult.taxpayer_name}</h3>
                    <p className="mt-1 text-slate-600">{searchResult.property_address}</p>
                    <p className="mt-2 text-sm font-semibold text-blue-700">TDN: {searchResult.tdn}</p>
                  </div>
                  <button
                    type="button"
                    onClick={addToCart}
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Add to Cart
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-sm text-slate-500">Fair Market Value</p>
                    <p className="text-xl font-bold text-slate-900">{formatCurrency(searchResult.fair_market_value)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-sm text-slate-500">Assessment Level</p>
                    <p className="text-xl font-bold text-slate-900">{searchResult.assessment_level}%</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-sm text-slate-500">Assessed Value</p>
                    <p className="text-xl font-bold text-slate-900">{formatCurrency(searchResult.assessed_value)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-sm text-slate-500">Amount to Pay</p>
                    <p className="text-xl font-bold text-blue-800">{formatCurrency(searchResult.amount_to_pay)}</p>
                    <p className="text-xs text-slate-500 mt-1">Read-only LGU-style computed amount</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-slate-500">Basic Tax Due</p>
                    <p className="font-bold text-slate-900">{formatCurrency(searchResult.basic_tax_due)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-slate-500">SEF Tax</p>
                    <p className="font-bold text-slate-900">{formatCurrency(searchResult.sef_tax)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-slate-500">Penalties</p>
                    <p className="font-bold text-slate-900">{formatCurrency(searchResult.penalties)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-slate-500">Discounts</p>
                    <p className="font-bold text-slate-900">{formatCurrency(searchResult.discounts)}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="card rounded-3xl shadow-lg">
            <p className="text-sm uppercase tracking-[0.18em] text-blue-700">Step 5 to 7</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-800">My Cart and Payment Initiation</h2>

            {cart.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-slate-500">
                Search a valid branch TDN and add the computed RPT entry to your cart.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {cart.map((item) => (
                  <div key={item.property_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-blue-700">{item.tdn}</p>
                        <h3 className="text-xl font-bold text-slate-900">{item.taxpayer_name}</h3>
                        <p className="text-slate-600">{item.property_address}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.property_id)}
                        className="rounded-2xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div className="rounded-2xl bg-white p-3">
                        <p className="text-slate-500">Basic Tax</p>
                        <p className="font-bold text-slate-900">{formatCurrency(item.basic_tax_due)}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-3">
                        <p className="text-slate-500">SEF Tax</p>
                        <p className="font-bold text-slate-900">{formatCurrency(item.sef_tax)}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-3">
                        <p className="text-slate-500">Penalties</p>
                        <p className="font-bold text-slate-900">{formatCurrency(item.penalties)}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-3">
                        <p className="text-slate-500">Discounts</p>
                        <p className="font-bold text-slate-900">{formatCurrency(item.discounts)}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-3">
                        <p className="text-slate-500">Amount Due</p>
                        <p className="font-bold text-blue-800">{formatCurrency(item.final_total_amount_due)}</p>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="rounded-3xl bg-slate-900 p-6 text-white">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm uppercase tracking-[0.18em] text-slate-300">Payment Summary</p>
                        <h3 className="text-3xl font-bold mt-2">{formatCurrency(totalPayable)}</h3>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-200 mb-2">Select PayMongo Payment Method</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {PAYMENT_METHOD_OPTIONS.map((option) => (
                            <button
                              key={option.code}
                              type="button"
                              onClick={() => setSelectedMethod(option.code)}
                              className={`rounded-2xl border px-4 py-4 text-left transition ${
                                selectedMethod === option.code
                                  ? 'border-cyan-300 bg-cyan-500/20'
                                  : 'border-white/20 bg-white/5 hover:bg-white/10'
                              }`}
                            >
                              <p className="font-semibold">{option.label}</p>
                              <p className="text-sm text-slate-300 mt-1">{option.detail}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4 lg:w-72">
                      <button
                        type="button"
                        onClick={handleCheckout}
                        disabled={checkoutLoading}
                        className="w-full rounded-2xl bg-cyan-400 px-5 py-4 text-base font-bold text-slate-900 hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {checkoutLoading ? 'Creating PayMongo Session...' : 'Proceed to Payment'}
                      </button>
                      <p className="text-sm text-slate-300">
                        WARDS will create a PayMongo sandbox checkout session and route your transaction to the selected Branch Treasury Validation Queue.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {latestCheckout?.checkout_url && (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
              <p className="text-sm uppercase tracking-[0.18em] text-emerald-700">PayMongo Session Ready</p>
              <h2 className="mt-2 text-2xl font-bold text-emerald-900">Hosted Checkout Created</h2>
              <p className="mt-3 text-emerald-800">
                WARDS Transaction Number: <span className="font-semibold">{latestCheckout.transaction.wards_transaction_no}</span>
              </p>
              <p className="mt-1 text-emerald-800">
                Payment Reference ID: <span className="font-semibold">{latestCheckout.payment_reference_id}</span>
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  href={latestCheckout.checkout_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary"
                >
                  Open PayMongo Sandbox Checkout
                </a>
                <button
                  type="button"
                  onClick={refreshTransactions}
                  className="btn-secondary"
                >
                  Refresh Transaction Status
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="space-y-8">
          <section className="card rounded-3xl shadow-lg">
            <p className="text-sm uppercase tracking-[0.18em] text-blue-700">Step 8 to 14</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-800">My RPT Transactions</h2>
            <p className="mt-2 text-sm text-gray-600">
              PayMongo webhook updates, proof submission, treasury validation, OR issuance, and release all appear here.
            </p>

            <div className="mt-6 space-y-4">
              {transactions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-slate-500">
                  No RPT payment transactions yet.
                </div>
              ) : (
                transactions.map((transaction) => {
                  const canUploadProof =
                    ['PAYMENT_INITIATED', 'PAYMENT_SUBMITTED', 'PENDING_TREASURY_VALIDATION'].includes(transaction.status) &&
                    transaction.proofs.length === 0

                  return (
                    <div key={transaction.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-blue-700">{transaction.wards_transaction_no}</p>
                          <h3 className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(transaction.total_amount)}</h3>
                          <p className="text-sm text-slate-600 mt-1">{transaction.branch_name}</p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-800">
                          {transaction.status.replaceAll('_', ' ')}
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 text-sm text-slate-700">
                        <p><span className="font-semibold">Payment Method:</span> {transaction.payment_method}</p>
                        <p><span className="font-semibold">PayMongo Reference:</span> {transaction.proof_reference || transaction.paymongo_reference_id || 'Pending'}</p>
                        {transaction.official_receipt_number && (
                          <p><span className="font-semibold">Official Receipt:</span> {transaction.official_receipt_number}</p>
                        )}
                        {transaction.official_receipt_pdf_path && (
                          <p>
                            <a
                              href={`http://localhost:8000/${transaction.official_receipt_pdf_path}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary-700 font-semibold hover:underline"
                            >
                              Download Computerized Official Receipt PDF
                            </a>
                          </p>
                        )}
                        {transaction.proofs.length > 0 && (
                          <p>
                            <a
                              href={`http://localhost:8000/${transaction.proofs[0].file_path}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary-700 font-semibold hover:underline"
                            >
                              View Uploaded Payment Proof
                            </a>
                          </p>
                        )}
                      </div>

                      {canUploadProof && (
                        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
                          <p className="font-semibold text-slate-900">Upload Payment Proof</p>
                          <p className="text-sm text-slate-600 mt-1">
                            Allowed file types: JPG, PNG, PDF. Maximum size: 5MB.
                          </p>
                          <div className="mt-4 space-y-3">
                            <input
                              type="text"
                              value={proofReferences[transaction.id] || ''}
                              onChange={(e) => setProofReferences((current) => ({ ...current, [transaction.id]: e.target.value }))}
                              className="input-field"
                              placeholder="Enter PayMongo receipt/reference"
                            />
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.pdf"
                              onChange={(e) => setProofFiles((current) => ({ ...current, [transaction.id]: e.target.files?.[0] || null }))}
                              className="input-field"
                            />
                            <button
                              type="button"
                              onClick={() => handleProofSubmit(transaction.id)}
                              disabled={uploadingProofFor === transaction.id}
                              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {uploadingProofFor === transaction.id ? 'Submitting Proof...' : 'Submit Payment Proof'}
                            </button>
                          </div>
                        </div>
                      )}

                      {transaction.logs.length > 0 && (
                        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
                          <p className="font-semibold text-slate-900 mb-3">Transaction Log</p>
                          <div className="space-y-3">
                            {transaction.logs.slice(0, 4).map((log, index) => (
                              <div key={`${transaction.id}-${index}`} className="border-l-2 border-slate-200 pl-3">
                                <p className="text-sm font-semibold text-slate-800">{log.status.replaceAll('_', ' ')}</p>
                                <p className="text-sm text-slate-600">{log.message}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default RPTOnlinePayment
