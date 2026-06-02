import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { receiptAPI } from '../../services/api';

const MobileReceiptUpload = () => {
  const { token } = useParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [session, setSession] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await receiptAPI.getMobileUploadPublicSession(token);
        setSession(response.data);
        if (response.data?.result) {
          setReceiptDraft(response.data.result);
        }
        if (response.data?.status === 'saved') {
          setMessage('Receipt saved to Receipt Management.');
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'This mobile receipt upload link is invalid or expired.');
      } finally {
        setLoading(false);
      }
    };

    loadSession();
    return () => {
      stopCamera();
    };
  }, [token]);

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

  const updateSelectedFile = (nextFile) => {
    setFile(nextFile);
    setError('');
    setMessage('');
    setPreviewUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return nextFile ? URL.createObjectURL(nextFile) : '';
    });
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraSupported(false);
      setError('Camera capture is not supported by this browser. You can still choose an image file.');
      return;
    }

    try {
      setCameraLoading(true);
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err) {
      setError('Camera permission was blocked or no camera was found. You can still choose an image file.');
    } finally {
      setCameraLoading(false);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('Camera is still starting. Please try again in a moment.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Failed to capture receipt photo. Please try again.');
        return;
      }
      const capturedFile = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
      updateSelectedFile(capturedFile);
      stopCamera();
    }, 'image/jpeg', 0.92);
  };

  const retakePhoto = () => {
    updateSelectedFile(null);
    startCamera();
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) {
      setError('Choose or take a receipt photo first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    try {
      setUploading(true);
      setError('');
      const response = await receiptAPI.uploadMobileReceipt(token, formData);
      setMessage(response.data?.message || 'Receipt parsed. Please review before saving.');
      setReceiptDraft(response.data?.result || null);
      setSession((current) => ({ ...current, status: 'processed' }));
      stopCamera();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to upload receipt.');
    } finally {
      setUploading(false);
    }
  };

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setReceiptDraft((current) => ({
      ...current,
      [name]: name === 'amount' ? (value === '' ? '' : Number(value)) : value,
    }));
  };

  const handleSaveReceipt = async (event) => {
    event.preventDefault();
    if (!receiptDraft) {
      setError('Upload and parse a receipt before saving.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const response = await receiptAPI.saveMobileReceipt(token, {
        ...receiptDraft,
        amount: receiptDraft.amount === '' ? null : receiptDraft.amount,
        tax_type: receiptDraft.tax_type || session?.category,
        selected_category: receiptDraft.selected_category || session?.category,
        detected_category: receiptDraft.detected_category || session?.category,
        category_match: receiptDraft.category_match !== false,
        auto_rename_source_image: receiptDraft.auto_rename_source_image === true,
      });
      setMessage(response.data?.message || 'Receipt saved to Receipt Management.');
      setSession((current) => ({ ...current, status: 'saved', record_id: response.data?.record?.id }));
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError((typeof detail === 'object' ? detail?.message : detail) || 'Failed to save receipt.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="rounded-3xl bg-white p-8 text-center shadow-xl">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#0f5b83] border-t-transparent" />
          <p className="mt-4 text-sm text-slate-600">Loading receipt upload...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ecf3fb_0%,#f8fbff_100%)] px-4 py-8">
      <div className="mx-auto max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="bg-[#0f2f5f] px-6 py-8 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-100">WARDS Mobile Receipt Upload</p>
          <h1 className="mt-3 text-3xl font-bold">Upload Receipt Photo</h1>
          {session ? (
            <p className="mt-3 text-sm leading-6 text-blue-100">
              Queue {session.queue_number} | Category {session.category}
            </p>
          ) : null}
        </div>

        <div className="p-6">
          {(message || error) ? (
            <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {error || message}
            </div>
          ) : null}

          {session?.status === 'saved' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-8 text-center text-emerald-800">
              <p className="text-lg font-bold">Receipt saved.</p>
              <p className="mt-2 text-sm">This receipt is now in Receipt Management.</p>
            </div>
          ) : receiptDraft ? (
            <form onSubmit={handleSaveReceipt} className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Category: <span className="font-bold text-slate-900">{receiptDraft.selected_category || session?.category}</span>
                {' | '}
                Confidence: <span className="font-bold text-slate-900">{receiptDraft.confidence || 0}</span>
              </div>
              {receiptDraft.filename_matches_taxpayer === false && !receiptDraft.auto_rename_source_image ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <p className="font-semibold">File name needs correction</p>
                  <p className="mt-1">{receiptDraft.file_name_validation_message || 'The uploaded file name must match the extracted taxpayer name.'}</p>
                  {receiptDraft.source_image_suggested_filename ? (
                    <p className="mt-1">Suggested file name: {receiptDraft.source_image_suggested_filename}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setReceiptDraft((current) => ({
                      ...current,
                      auto_rename_source_image: true,
                      filename_matches_taxpayer: true,
                      save_blocked: Boolean(current?.duplicate_detected),
                    }))}
                    className="mt-3 rounded-2xl bg-[#0f5b83] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]"
                  >
                    Use Extracted Taxpayer Name
                  </button>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Reference Number</span>
                  <input name="ref_number" value={receiptDraft.ref_number || ''} onChange={handleDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0f5b83]" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Taxpayer Name</span>
                  <input name="taxpayer_name" value={receiptDraft.taxpayer_name || ''} onChange={handleDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0f5b83]" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Transaction Date</span>
                  <input name="transaction_date" value={receiptDraft.transaction_date || ''} onChange={handleDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0f5b83]" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Amount</span>
                  <input name="amount" type="number" step="0.01" value={receiptDraft.amount ?? ''} onChange={handleDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0f5b83]" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setReceiptDraft(null);
                    setMessage('');
                    updateSelectedFile(null);
                  }}
                  disabled={saving}
                  className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  Upload Another Photo
                </button>
                <button
                  type="submit"
                  disabled={saving || (receiptDraft.filename_matches_taxpayer === false && !receiptDraft.auto_rename_source_image)}
                  className="rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
                >
                  {saving ? 'Saving...' : (receiptDraft.filename_matches_taxpayer === false && !receiptDraft.auto_rename_source_image) ? 'Review Blocked' : 'Save Receipt'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleUpload} className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {cameraActive ? (
                  <div className="space-y-4">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="aspect-[3/4] w-full rounded-2xl bg-slate-900 object-cover"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={capturePhoto}
                        className="rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]"
                      >
                        Capture Photo
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Close Camera
                      </button>
                    </div>
                  </div>
                ) : previewUrl ? (
                  <div className="space-y-4">
                    <img
                      src={previewUrl}
                      alt="Captured receipt preview"
                      className="max-h-[520px] w-full rounded-2xl bg-slate-100 object-contain"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={retakePhoto}
                        className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Retake Photo
                      </button>
                      <label className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                        Choose Different File
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => updateSelectedFile(event.target.files?.[0] || null)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={startCamera}
                      disabled={cameraLoading || !cameraSupported}
                      className="w-full rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
                    >
                      {cameraLoading ? 'Opening Camera...' : 'Open Camera'}
                    </button>
                    <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      <span className="h-px flex-1 bg-slate-200" />
                      Or
                      <span className="h-px flex-1 bg-slate-200" />
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Choose Receipt Image</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(event) => updateSelectedFile(event.target.files?.[0] || null)}
                        className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm"
                      />
                    </label>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={uploading || !file}
                className="w-full rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
              >
                {uploading ? 'Uploading and Parsing...' : 'Upload Receipt'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
};

export default MobileReceiptUpload;
