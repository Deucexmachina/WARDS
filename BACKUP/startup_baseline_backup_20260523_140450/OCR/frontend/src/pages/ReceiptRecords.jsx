import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'

/* ✅ FIX: trailing slashes */
const API_URL = 'http://localhost:8000/api/receipts/process/'
const LIST_URL = 'http://localhost:8000/api/receipts/'

function ReceiptRecords() {
  const navigate = useNavigate()
  const location = useLocation()

  const [category, setCategory] = useState('')
  const [file, setFile] = useState(null)
  const [alert, setAlert] = useState('')
  const [alertType, setAlertType] = useState('info')
  const [loading, setLoading] = useState(false)

  const [receipts, setReceipts] = useState([])
  const [search, setSearch] = useState('')
  const [showOCR, setShowOCR] = useState(false)
  const [activeTab, setActiveTab] = useState('RPT')

  /* ============================
     SUMMARY STATE
  ============================ */
  const [summary, setSummary] = useState(null)

  /* ============================
     AUTO TOGGLE OCR BY ROUTE
  ============================ */
  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('user') || 'null')
    if (storedUser?.role === 'branch_staff') {
      navigate('/admin/queue')
      return
    }
  }, [navigate])

  useEffect(() => {
    if (location.pathname.endsWith('/add')) {
      setShowOCR(true)
    } else {
      setShowOCR(false)
    }
  }, [location.pathname])

  /* ============================
     LOAD RECEIPTS
  ============================ */
  useEffect(() => {
    fetchReceipts()
  }, [])

  const fetchReceipts = async () => {
    try {
      const res = await axios.get(LIST_URL)
      setReceipts(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  /* ============================
     DELETE RECEIPT
  ============================ */
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this receipt?')) return
    try {
      await axios.delete(`http://localhost:8000/api/receipts/${id}/`)
      fetchReceipts()
    } catch (err) {
      console.error(err)
      alert('Failed to delete receipt')
    }
  }

  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (!f) return

    if (!['image/jpeg', 'image/png'].includes(f.type)) {
      setAlertType('error')
      setAlert('Only JPG or PNG files are allowed.')
      return
    }

    if (f.size > 10 * 1024 * 1024) {
      setAlertType('error')
      setAlert('File exceeds 10 MB limit.')
      return
    }

    setAlert('')
    setFile(f)
  }

  const handleSubmit = async () => {
    if (!category || !file) {
      setAlertType('error')
      setAlert('Please select a receipt category and upload a file.')
      return
    }

    const formData = new FormData()
    formData.append('category', category)
    formData.append('file', file)

    try {
      setLoading(true)
      setAlertType('info')
      setAlert('Processing receipt via OCR…')

      const res = await axios.post(API_URL, formData)

      setAlertType('success')
      setAlert('Receipt processed successfully. Redirecting to review…')

      setTimeout(() => {
        navigate('/admin/receipts/edit', {
          state: {
            category,
            image_path: res.data.image_path,
            extracted_fields: res.data.extracted_fields,
            raw_ocr: res.data.raw_ocr
          }
        })
      }, 800)
    } catch (err) {
      console.error(err)
      setAlertType('error')
      setAlert('OCR processing failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const filteredReceipts = receipts
    .filter(r => r.category === activeTab)
    .filter(r =>
      r.taxpayer_name.toLowerCase().includes(search.toLowerCase())
    )

  /* ============================
     AUTO SUMMARY BY SEARCH
  ============================ */
  useEffect(() => {
    if (!search.trim()) {
      setSummary(null)
      return
    }

    const matches = receipts.filter(r =>
      r.taxpayer_name.toLowerCase().includes(search.toLowerCase())
    )

    if (matches.length === 0) {
      setSummary(null)
      return
    }

    const activeReceipts = matches.filter(r => r.category === activeTab)

    const total = activeReceipts.reduce(
      (sum, r) => sum + Number(r.amount_paid || 0),
      0
    )

    const dates = [
      ...new Set(
        activeReceipts
          .map(r => r.transaction_date)
          .filter(Boolean)
      )
    ]

    const images = activeReceipts
      .map(r => r.image_path)
      .filter(Boolean)

    setSummary({
      name: matches[0].taxpayer_name,
      total,
      dates,
      images
    })
  }, [search, receipts, activeTab])

  const handlePrintSummary = () => {
    window.print()
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">

      {/* ✅ ADDED: PRINT-ONLY CSS (NO LOGIC CHANGE) */}
      <style>{`
        @media print {
          @page {
            margin: 0;
            size: auto;
          }

          html, body {
            margin: 0;
            padding: 0;
            height: 100%;
          }

          body * {
            visibility: hidden;
          }

          .print-receipt,
          .print-receipt * {
            visibility: visible;
          }

          .print-receipt {
            position: fixed;
            inset: 0;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            background: white;
          }

          .print-receipt img {
            width: 100%;
            height: auto;
            max-height: 100vh;
            object-fit: contain;
            page-break-inside: avoid;
          }
        }
      `}</style>


      <div className="max-w-6xl mx-auto bg-white p-8 rounded-lg shadow">

        {/* HEADER */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">
            🧾 {showOCR ? 'Add Receipt Record' : 'Receipt Records Management'}
          </h1>

          {!showOCR && (
            <button
              onClick={() => navigate('/admin/receipts/add')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded font-semibold"
            >
              ➕ Add Record
            </button>
          )}
        </div>

        {showOCR && (
          <div className="space-y-4">
            {alert && (
              <div className={`p-3 rounded text-sm ${
                alertType === 'error'
                  ? 'bg-red-100 text-red-700'
                  : alertType === 'success'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {alert}
              </div>
            )}

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border p-2 rounded w-full"
            >
              <option value="">Select Category</option>
              <option value="RPT">RPT</option>
              <option value="BUSINESS">Business Tax</option>
              <option value="MISC">Miscellaneous</option>
            </select>

            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              className="border p-2 rounded w-full"
            />

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-semibold"
            >
              {loading ? 'Processing…' : 'Process Receipt'}
            </button>
          </div>
        )}

        {!showOCR && (
          <>
            <div className="flex gap-2 mb-4">
              {['RPT', 'BUSINESS', 'MISC'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded font-semibold ${
                    activeTab === tab
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200'
                  }`}
                >
                  {tab === 'BUSINESS' ? 'Business Tax' : tab}
                </button>
              ))}
            </div>

            <input
              className="border p-2 rounded w-full mb-4"
              placeholder="Search taxpayer name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {summary && (
              <div className="mb-6 p-4 border rounded bg-blue-50">
                <h2 className="font-bold text-lg mb-3">
                  📊 Summary for {summary.name}
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                  <div>
                    <strong>{activeTab} Total:</strong> ₱{summary.total.toFixed(2)}
                  </div>
                  <div>
                    <strong>Transaction Date(s):</strong>
                    <ul className="list-disc ml-5">
                      {summary.dates.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* ✅ ADDED WRAPPER: PRINT TARGET */}
                <div className="print-receipt grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {summary.images.map((img, i) => (
                    <img
                      key={i}
                      src={`http://localhost:8000/${img}`}
                      alt="Receipt"
                      className="border rounded shadow"
                    />
                  ))}
                </div>

                <button
                  onClick={handlePrintSummary}
                  className="bg-gray-800 hover:bg-black text-white px-4 py-2 rounded"
                >
                  🖨️ Print Summary
                </button>
              </div>
            )}

            <table className="w-full border text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">Name</th>
                  <th className="border p-2">Date</th>

                  {/* ✅ ADDED: BUSINESS HEADER */}
                  {activeTab === 'BUSINESS' && (
                    <th className="border p-2">Mayor’s Permit No.</th>
                  )}

                  {activeTab === 'RPT' && (
                    <th className="border p-2">Tax Declaration</th>
                  )}
                  {activeTab === 'MISC' && (
                    <th className="border p-2">Nature of Collection</th>
                  )}
                  <th className="border p-2">Amount</th>
                  <th className="border p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map(r => (
                  <tr key={r.id}>
                    <td className="border p-2">{r.taxpayer_name}</td>
                    <td className="border p-2">{r.transaction_date}</td>

                    {/* ✅ ADDED: BUSINESS VALUE */}
                    {activeTab === 'BUSINESS' && (
                      <td className="border p-2">
                        {r.mayors_permit_no || '—'}
                      </td>
                    )}

                    {activeTab === 'RPT' && (
                      <td className="border p-2">
                        {r.tax_declaration_no || '—'}
                      </td>
                    )}
                    {activeTab === 'MISC' && (
                      <td className="border p-2">
                        {r.nature_of_collection}
                      </td>
                    )}
                    <td className="border p-2">{r.amount_paid}</td>
                    <td className="border p-2 text-center">
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="text-red-600 hover:underline font-semibold"
                      >
                        🗑 Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          </>
        )}
      </div>
    </div>
  )
}

export default ReceiptRecords
