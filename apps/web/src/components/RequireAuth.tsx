import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getAuthToken } from '@/lib/api';

/** Gate extractor + classic pages behind login. */
export function RequireAuth() {
  const location = useLocation();
  const token = getAuthToken();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
