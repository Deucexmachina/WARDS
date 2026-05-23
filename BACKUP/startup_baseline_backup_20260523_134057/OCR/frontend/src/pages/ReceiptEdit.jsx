import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import axios from "axios";

const SAVE_URL = "http://localhost:8000/api/receipts/save";

function ReceiptEdit() {
  const { state } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
    if (storedUser?.role === 'branch_staff') {
      navigate('/admin/queue');
    }
  }, [navigate]);

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600 font-semibold">
          No receipt data found. Please upload again.
        </p>
      </div>
    );
  }

  const { category, image_path, extracted_fields, raw_ocr } = state;

  /* ============================
     CLEAN TAXPAYER NAME (RPT / MISC)
  ============================ */
  const cleanName = (name = "") => {
    return name
      .toUpperCase()
      .split("NATURE OF COLLECTION")[0]
      .split("FUND")[0]
      .trim();
  };

  /* ============================
     ✅ ADDED: BUSINESS COMPANY NAME CLEANER
  ============================ */
  const cleanCompanyName = (name = "") => {
    return name
      .replace(/^\d{2}-\d{6}\s*/g, "") // remove Mayor's Permit No
      .toUpperCase()
      .trim();
  };

  const [taxpayerName, setTaxpayerName] = useState(
    cleanName(extracted_fields?.taxpayer_name || "")
  );

  /* ============================
     ✅ ADDED: BUSINESS COMPANY STATE
  ============================ */
  const [companyName, setCompanyName] = useState(
    category === "BUSINESS"
      ? cleanCompanyName(extracted_fields?.taxpayer_name || "")
      : ""
  );

  const [date, setDate] = useState(
    extracted_fields?.transaction_date || ""
  );

  const [taxDeclaration, setTaxDeclaration] = useState(
    extracted_fields?.tax_declaration ||
    extracted_fields?.nature_of_collection ||
    ""
  );

  /* ============================
     ✅ ADDED: MAYOR'S PERMIT STATE
  ============================ */
  const [mayorsPermitNo, setMayorsPermitNo] = useState(
    extracted_fields?.mayors_permit_no || ""
  );

  const [amount, setAmount] = useState(
    extracted_fields?.amount || ""
  );

  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(100);

  /* ============================
     SAVE HANDLER
  ============================ */
  const handleSave = async () => {
    try {
      setSaving(true);

      const formData = new FormData();
      formData.append("category", category);
      formData.append(
        "taxpayer_name",
        category === "BUSINESS" ? companyName : taxpayerName
      );
      formData.append("transaction_date", date);

      // RPT
      formData.append(
        "tax_declaration_no",
        category === "RPT" ? taxDeclaration : ""
      );

      // MISC / BUSINESS
      formData.append(
        "nature_of_collection",
        category === "BUSINESS"
          ? mayorsPermitNo
          : category === "MISC"
          ? taxDeclaration
          : ""
      );

      formData.append("amount_paid", amount);
      formData.append("image_path", image_path);

      await axios.post(SAVE_URL, formData);

      navigate("/admin/receipts");
    } catch (err) {
      console.error(err);
      alert("Failed to save receipt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto bg-white p-6 rounded-xl shadow">

        <div className="mb-4 p-3 bg-green-100 border border-green-400 rounded text-green-800 font-semibold">
          ✅ OCR processed successfully — please review and edit before saving.
        </div>

        <h1 className="text-2xl font-bold mb-6">
          🧾 Edit Receipt — {category}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* IMAGE */}
          <div>
            <h2 className="font-semibold mb-2">📸 Scanned Receipt</h2>

            <div className="mb-2">
              <label className="text-sm font-medium">
                🔍 Zoom: {zoom}%
              </label>
              <input
                type="range"
                min="100"
                max="300"
                step="10"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="border rounded bg-gray-50 overflow-auto h-[520px]">
              <div className="p-4 flex justify-center">
                <img
                  src={`http://localhost:8000/${image_path}`}
                  alt="Receipt"
                  style={{
                    width: `${zoom}%`,
                    height: "auto",
                    maxWidth: "none",
                  }}
                />
              </div>
            </div>
          </div>

          {/* FORM */}
          <div className="space-y-4">
            <h2 className="font-semibold">
              ✏️ Extracted Information (Editable)
            </h2>

            {/* TAXPAYER / COMPANY */}
            {category === "BUSINESS" ? (
              <div>
                <label className="block text-sm font-medium">
                  Company Name
                </label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full border p-2 rounded"
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium">
                  Taxpayer Name
                </label>
                <input
                  value={taxpayerName}
                  onChange={(e) => setTaxpayerName(e.target.value)}
                  className="w-full border p-2 rounded"
                />
              </div>
            )}

            {/* DATE */}
            <div>
              <label className="block text-sm font-medium">
                Transaction Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border p-2 rounded"
              />
            </div>

            {/* MAYOR'S PERMIT — BUSINESS ONLY */}
            {category === "BUSINESS" && (
              <div>
                <label className="block text-sm font-medium">
                  Mayor&apos;s Permit No.
                </label>
                <input
                  value={mayorsPermitNo}
                  onChange={(e) => setMayorsPermitNo(e.target.value)}
                  className="w-full border p-2 rounded"
                />
              </div>
            )}

            {/* RPT / MISC ONLY */}
            {category !== "BUSINESS" && (
              <div>
                <label className="block text-sm font-medium">
                  {category === "RPT"
                    ? "Tax Declaration"
                    : "Nature of Collection"}
                </label>
                <input
                  value={taxDeclaration}
                  onChange={(e) => setTaxDeclaration(e.target.value)}
                  className="w-full border p-2 rounded"
                />
              </div>
            )}

            {/* AMOUNT */}
            <div>
              <label className="block text-sm font-medium">
                Amount Paid
              </label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border p-2 rounded"
              />
            </div>

            <div className="flex gap-4 pt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-2 rounded font-semibold"
              >
                💾 {saving ? "Saving…" : "Save Receipt"}
              </button>

              <button
                onClick={() => navigate("/admin/receipts")}
                className="bg-gray-400 hover:bg-gray-500 text-white px-6 py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        <details className="mt-6">
          <summary className="cursor-pointer font-semibold">
            🔍 View Raw OCR Output
          </summary>
          <pre className="bg-gray-100 p-4 rounded text-xs whitespace-pre-wrap mt-2">
            {raw_ocr}
          </pre>
        </details>

      </div>
    </div>
  );
}

export default ReceiptEdit;
