const ConfirmModal = ({ show, title, message, onClose }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
            <svg className="h-10 w-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-primary mb-2">{title}</h3>
          <p className="text-gray-600 mb-6">{message}</p>
          <button 
            onClick={onClose}
            className="bg-primary hover:bg-secondary text-white px-8 py-3 rounded-lg font-semibold transition duration-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
