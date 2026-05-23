import { Navigate } from 'react-router-dom';
import { getBranchPortalPath } from '../utils/auth';

const BranchPortalRedirect = () => {
  let branchUser = {};

  try {
    branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  } catch {
    branchUser = {};
  }

  return <Navigate to={getBranchPortalPath(branchUser)} replace />;
};

export default BranchPortalRedirect;
