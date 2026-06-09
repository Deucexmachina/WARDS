import { useState } from 'react';
import axios from 'axios';
import WardsPageHero from '../../components/WardsPageHero';
import ProcessingModal from '../../components/ProcessingModal';
import SystemMessageModal from '../../components/SystemMessageModal';

const API_BASE_URL = 'http://localhost:8000/api';

const ReceiptManagement = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [messageModal, setMessageModal] = useState(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      setMessageModal({
        tone: 'warning',
        title: 'Invalid File Type',
        message: 'Only PNG and JPEG files are allowed.',
      });
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadResult(null);
  };

  const handleUpload = async () => {
    if (uploading) {
      return;
    }

    if (!selectedFile) {
      setMessageModal({
        tone: 'warning',
        title: 'File Required',
        message: 'Please select a receipt image before running OCR.',
      });
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await axios.post(`${API_BASE_URL}/ocr/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setUploadResult(response.data);
      setMessageModal({
        tone: 'success',
        title: 'Receipt Processed',
        message: 'The receipt was uploaded and processed successfully.',
      });
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadResult(null);
  };

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Receipt Management"
        subtitle="Upload, review, and process receipt records through the OCR-assisted receipt management workspace."
      />

      <div className="grid md:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Upload Receipt</h2>
          
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleFileSelect}
                disabled={uploading}
                className="hidden"
                id="receipt-upload"
              />
              <label htmlFor="receipt-upload" className="cursor-pointer">
                <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                </svg>
                <p className="text-gray-600 mb-2">Click to upload receipt image</p>
                <p className="text-sm text-gray-500">PNG, JPG up to 10MB</p>
              </label>
            </div>

            {selectedFile && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">Selected:</span> {selectedFile.name}
                </p>
                <p className="text-sm text-gray-600">
                  Size: {(selectedFile.size / 1024).toFixed(2)} KB
                </p>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? 'Running OCR...' : 'Run OCR'}
              </button>
              <button
                onClick={handleClear}
                disabled={uploading}
                className="px-6 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Preview Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Preview</h2>
          
          {previewUrl ? (
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <img src={previewUrl} alt="Receipt preview" className="w-full h-auto" />
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
              </svg>
              <p className="text-gray-500">No image selected</p>
            </div>
          )}
        </div>
      </div>

      {/* Extracted Data Section */}
      {uploadResult && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Extracted Receipt Data</h2>
          
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Receipt Number</label>
              <input
                type="text"
                value={uploadResult.receipt_number || ''}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Amount</label>
              <input
                type="text"
                value={uploadResult.amount || ''}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
              <input
                type="text"
                value={uploadResult.date || ''}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Taxpayer Name</label>
              <input
                type="text"
                value={uploadResult.taxpayer_name || ''}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                readOnly
              />
            </div>
          </div>

          <div className="mt-6 flex gap-4">
            <button className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700">
              Verify & Save
            </button>
            <button className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400">
              Edit Data
            </button>
          </div>
        </div>
      )}

      <ProcessingModal
        show={uploading}
        title="Processing OCR"
        message="Processing OCR... Please wait."
      />
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

export default ReceiptManagement;
