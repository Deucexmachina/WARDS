import { createContext, useContext, useRef, useState, useCallback } from 'react';

const UnsavedChangesContext = createContext(null);

export const UnsavedChangesProvider = ({ children }) => {
  const [isDirty, setIsDirty] = useState(false);
  const saveRef = useRef(null);

  const registerDirty = useCallback((dirty, saveFn = null) => {
    setIsDirty(dirty);
    saveRef.current = saveFn;
  }, []);

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, registerDirty, saveRef }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
};

export const useUnsavedChanges = () => useContext(UnsavedChangesContext);
