import { useEffect, useState } from 'react';
import SystemMessageModal from './SystemMessageModal';

const GlobalSystemMessageModal = () => {
  const [messageModal, setMessageModal] = useState(null);

  useEffect(() => {
    const handleSystemMessage = (event) => {
      setMessageModal(event.detail || null);
    };

    window.addEventListener('wards:system-message', handleSystemMessage);
    return () => window.removeEventListener('wards:system-message', handleSystemMessage);
  }, []);

  return (
    <SystemMessageModal
      open={Boolean(messageModal)}
      tone={messageModal?.tone}
      title={messageModal?.title}
      message={messageModal?.message}
      buttonLabel={messageModal?.buttonLabel}
      onClose={() => {
        const callback = messageModal?.onClose;
        setMessageModal(null);
        callback?.();
      }}
    />
  );
};

export default GlobalSystemMessageModal;
