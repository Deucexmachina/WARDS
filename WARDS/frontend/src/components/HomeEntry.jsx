import { Navigate } from 'react-router-dom';

import Home from '../pages/public/Home';
import { getPortalHome, getStoredPortal } from '../utils/auth';

const hasAdminSession = () => {
  const token = localStorage.getItem('adminToken');
  const user = localStorage.getItem('adminUser');
  return Boolean(token && token !== 'null' && user && user !== 'null');
};

const hasBranchSession = () => {
  const token = localStorage.getItem('branchToken');
  const user = localStorage.getItem('branchUser');
  return Boolean(token && token !== 'null' && user && user !== 'null');
};

const HomeEntry = () => {
  const portal = getStoredPortal();

  if (portal === 'admin' && hasAdminSession()) {
    return <Navigate to={getPortalHome(portal)} replace />;
  }

  if (portal === 'branch' && hasBranchSession()) {
    return <Navigate to={getPortalHome(portal)} replace />;
  }

  return <Home />;
};

export default HomeEntry;
