import { Navigate } from 'react-router-dom';

import Home from '../pages/public/Home';
import { getPortalHome, getStoredPortal } from '../utils/auth';

const HomeEntry = () => {
  const portal = getStoredPortal();

  if (portal && portal !== 'public') {
    return <Navigate to={getPortalHome(portal)} replace />;
  }

  return <Home />;
};

export default HomeEntry;
