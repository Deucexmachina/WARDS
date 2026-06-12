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
  const analysisCanvasRef = useRef(null);
  const [validation, setValidation] = useState({
    isValid: false,
    message: 'Initializing camera...',
    checking: false,
  });
  const [debugMetrics, setDebugMetrics] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const validationIntervalRef = useRef(null);
  const countdownRef = useRef(null);

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
          const draft = response.data.result;
          if (draft.filename_matches_taxpayer === false) {
            draft.auto_rename_source_image = true;
            draft.filename_matches_taxpayer = true;
          }
          setReceiptDraft(draft);
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

  useEffect(() => {
    if (session?.status === 'saved') {
      let secondsLeft = 5;
      setCountdown(secondsLeft);
      countdownRef.current = setInterval(() => {
        secondsLeft -= 1;
        setCountdown(secondsLeft);
        if (secondsLeft <= 0) {
          clearInterval(countdownRef.current);
          window.close();
        }
      }, 1000);
      return () => clearInterval(countdownRef.current);
    }
  }, [session?.status]);

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

  useEffect(() => {
    if (!cameraActive) {
      if (validationIntervalRef.current) {
        clearInterval(validationIntervalRef.current);
        validationIntervalRef.current = null;
      }
      return;
    }
    const canvas = analysisCanvasRef.current;
    if (canvas) {
      canvas.width = ANALYSIS_WIDTH;
      canvas.height = ANALYSIS_HEIGHT;
    }
    setValidation({ isValid: false, message: 'Analyzing camera feed...', checking: true });
    validationIntervalRef.current = setInterval(runValidation, 300);
    return () => {
      if (validationIntervalRef.current) {
        clearInterval(validationIntervalRef.current);
        validationIntervalRef.current = null;
      }
    };
  }, [cameraActive]);

  const updateSelectedFile = (nextFile) => {
    if (nextFile) {
      const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!ALLOWED_TYPES.includes(nextFile.type)) {
        setError('Only PNG and JPEG files are allowed.');
        setMessage('');
        return;
      }
    }
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
    if (!validation.isValid) {
      setError(validation.message || 'Please wait for a valid receipt frame before capturing.');
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

  const ANALYSIS_WIDTH = 320;
  const ANALYSIS_HEIGHT = 240;

  const computeLaplacianVariance = (gray, width, height) => {
    let sum = 0;
    let sumSq = 0;
    const count = (width - 2) * (height - 2);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const laplacian =
          -4 * gray[i] +
          gray[i - 1] +
          gray[i + 1] +
          gray[i - width] +
          gray[i + width];
        sum += laplacian;
        sumSq += laplacian * laplacian;
      }
    }
    const mean = sum / count;
    return sumSq / count - mean * mean;
  };

  const analyzeCameraFrame = () => {
    const video = videoRef.current;
    const canvas = analysisCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const imageData = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const data = imageData.data;
    const pixels = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;

    const gray = new Uint8Array(pixels);
    let totalBrightness = 0;
    let darkPixels = 0;
    let brightPixels = 0;
    let veryBrightPixels = 0;
    let warmPixels = 0;
    let centerEdgePixels = 0;

    const cx0 = Math.floor(ANALYSIS_WIDTH * 0.2);
    const cx1 = Math.floor(ANALYSIS_WIDTH * 0.8);
    const cy0 = Math.floor(ANALYSIS_HEIGHT * 0.2);
    const cy1 = Math.floor(ANALYSIS_HEIGHT * 0.8);

    for (let i = 0; i < pixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = brightness;
      totalBrightness += brightness;
      if (brightness < 35) darkPixels++;
      if (brightness > 210) brightPixels++;
      if (brightness > 245) veryBrightPixels++;

      // Warm / skin-tone detection
      if (r > g && g > b && r > 80 && g > 50 && b > 20 && r - g < 80) {
        warmPixels++;
      }
      if (r > b && g > b && r > 120 && g > 80 && r - b > 20 && g - b > 10) {
        warmPixels++;
      }
    }

    const avgBrightness = totalBrightness / pixels;
    const darkRatio = darkPixels / pixels;
    const brightRatio = brightPixels / pixels;
    const veryBrightRatio = veryBrightPixels / pixels;
    const warmRatio = warmPixels / pixels;

    // Brightness standard deviation = contrast / texture measure
    let brightnessVariance = 0;
    for (let i = 0; i < pixels; i++) {
      const diff = gray[i] - avgBrightness;
      brightnessVariance += diff * diff;
    }
    const brightnessStdDev = Math.sqrt(brightnessVariance / pixels);

    // Edge density using Sobel-like gradients
    let totalGrad = 0;
    for (let y = 1; y < ANALYSIS_HEIGHT - 1; y++) {
      for (let x = 1; x < ANALYSIS_WIDTH - 1; x++) {
        const i = y * ANALYSIS_WIDTH + x;
        const gx = gray[i + 1] - gray[i - 1];
        const gy = gray[i + ANALYSIS_WIDTH] - gray[i - ANALYSIS_WIDTH];
        const mag = Math.sqrt(gx * gx + gy * gy);
        totalGrad += mag;
        if (mag > 20) {
          if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
            centerEdgePixels++;
          }
        }
      }
    }
    const avgGrad = totalGrad / ((ANALYSIS_WIDTH - 2) * (ANALYSIS_HEIGHT - 2));
    const centerEdgeRatio = centerEdgePixels / ((cx1 - cx0) * (cy1 - cy0));

    // Laplacian variance for blur
    const lapVar = computeLaplacianVariance(gray, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);

    // Horizontal line structure detection (text-like pattern)
    const lineScores = [];
    const scanYStart = cy0;
    const scanYEnd = cy1;
    for (let y = scanYStart; y < scanYEnd; y += 2) {
      let lineEdges = 0;
      for (let x = cx0 + 1; x < cx1 - 1; x++) {
        const i = y * ANALYSIS_WIDTH + x;
        const gx = gray[i + 1] - gray[i - 1];
        if (Math.abs(gx) > 15) lineEdges++;
      }
      lineScores.push(lineEdges);
    }
    const avgLineScore = lineScores.reduce((a, b) => a + b, 0) / (lineScores.length || 1);
    const highLineCount = lineScores.filter((s) => s > avgLineScore * 1.2).length;
    const lowLineCount = lineScores.filter((s) => s < avgLineScore * 0.5).length;
    const hasHorizontalStructure =
      avgLineScore > 3 &&
      highLineCount > lineScores.length * 0.15 &&
      lowLineCount > lineScores.length * 0.15;

    // Document detection logic
    const isUniform = brightnessStdDev < 15;
    const isLikelyFace = warmRatio > 0.08 && brightnessStdDev < 35;
    const hasCenterTexture = centerEdgeRatio > 0.02 && brightnessStdDev > 18;
    const hasDocument = hasCenterTexture || hasHorizontalStructure;

    return {
      avgBrightness,
      darkRatio,
      brightRatio,
      veryBrightRatio,
      brightnessStdDev,
      warmRatio,
      centerEdgeRatio,
      avgLineScore: Math.round(avgLineScore * 10) / 10,
      hasHorizontalStructure,
      lapVar: Math.round(lapVar),
      avgGrad: Math.round(avgGrad * 10) / 10,
      isUniform,
      isLikelyFace,
      hasCenterTexture,
      hasDocument,
    };
  };

  const runValidation = () => {
    if (!cameraActive) return;
    setValidation((prev) => ({ ...prev, checking: true }));
    const result = analyzeCameraFrame();
    if (!result) {
      setValidation({ isValid: false, message: 'Camera not ready...', checking: false });
      return;
    }

    if (result.darkRatio > 0.45 || result.avgBrightness < 40) {
      setDebugMetrics(result);
      setValidation({ isValid: false, message: 'Image is too dark. Please improve lighting.', checking: false });
      return;
    }
    if (result.veryBrightRatio > 0.25 || result.avgBrightness > 215) {
      setDebugMetrics(result);
      setValidation({ isValid: false, message: 'Image is overexposed. Please reduce glare or move to a shaded area.', checking: false });
      return;
    }
    if (result.lapVar < 80) {
      setDebugMetrics(result);
      setValidation({ isValid: false, message: 'Image is too blurry. Please hold the camera steady.', checking: false });
      return;
    }
    if (result.isUniform) {
      setDebugMetrics(result);
      setValidation({ isValid: false, message: 'Receipt not detected. Please place the receipt inside the camera view.', checking: false });
      return;
    }
    if (result.isLikelyFace) {
      setDebugMetrics(result);
      setValidation({ isValid: false, message: 'Receipt not detected. Please place the receipt inside the camera view.', checking: false });
      return;
    }
    if (!result.hasDocument) {
      setDebugMetrics(result);
      setValidation({ isValid: false, message: 'Receipt not detected. Please place the receipt inside the camera view.', checking: false });
      return;
    }

    setDebugMetrics(result);
    setValidation({ isValid: true, message: 'Receipt detected. Hold steady to capture.', checking: false });
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
      const draft = response.data?.result || null;
      if (draft && draft.filename_matches_taxpayer === false) {
        draft.auto_rename_source_image = true;
        draft.filename_matches_taxpayer = true;
      }
      setReceiptDraft(draft);
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
              <p className="mt-3 text-sm font-semibold">Closing page in {countdown} second{countdown !== 1 ? 's' : ''}...</p>
            </div>
          ) : receiptDraft ? (
            <form onSubmit={handleSaveReceipt} className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Category: <span className="font-bold text-slate-900">{receiptDraft.selected_category || session?.category}</span>
                {' | '}
                Confidence: <span className="font-bold text-slate-900">{receiptDraft.confidence || 0}</span>
              </div>
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
                  disabled={saving}
                  className="rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Receipt'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleUpload} className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {cameraActive ? (
                  <div className="space-y-4">
                    <div className="relative">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="aspect-[3/4] w-full rounded-2xl bg-slate-900 object-cover"
                      />
                      <canvas ref={analysisCanvasRef} className="hidden" />
                      <div className={`absolute left-3 right-3 top-3 rounded-xl px-3 py-2 text-xs font-semibold backdrop-blur-sm ${
                        validation.isValid
                          ? 'bg-emerald-500/90 text-white'
                          : 'bg-amber-500/90 text-white'
                      }`}>
                        <div className="flex items-center gap-2">
                          {validation.checking ? (
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          ) : (
                            <span className={`inline-block h-2 w-2 rounded-full ${validation.isValid ? 'bg-emerald-200' : 'bg-amber-200'}`} />
                          )}
                          {validation.message}
                        </div>
                      </div>
                      {debugMetrics && (
                        <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-black/70 px-2 py-1.5 text-[9px] font-mono text-white/90 backdrop-blur-sm">
                          <div className="grid grid-cols-3 gap-x-1 gap-y-0.5">
                            <span>bright:{Math.round(debugMetrics.avgBrightness)}</span>
                            <span>std:{Math.round(debugMetrics.brightnessStdDev)}</span>
                            <span>warm:{Math.round(debugMetrics.warmRatio * 100)}%</span>
                            <span>edge:{Math.round(debugMetrics.centerEdgeRatio * 1000) / 10}%</span>
                            <span>line:{debugMetrics.avgLineScore}</span>
                            <span>blur:{debugMetrics.lapVar}</span>
                            <span>uniform:{debugMetrics.isUniform ? 'Y' : 'N'}</span>
                            <span>face:{debugMetrics.isLikelyFace ? 'Y' : 'N'}</span>
                            <span>doc:{debugMetrics.hasDocument ? 'Y' : 'N'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={capturePhoto}
                        disabled={!validation.isValid}
                        className="rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-40"
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
                          accept="image/png,image/jpeg"
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
                      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3">
                        <label className="shrink-0 cursor-pointer rounded-2xl bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]">
                          Choose File
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(event) => updateSelectedFile(event.target.files?.[0] || null)}
                            className="hidden"
                          />
                        </label>
                        <span className="truncate text-sm text-slate-600">
                          {file ? file.name : 'No file chosen'}
                        </span>
                      </div>
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
