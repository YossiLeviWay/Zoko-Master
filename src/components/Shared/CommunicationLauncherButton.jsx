import { MailPlus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { normalizeCommunicationContext } from '../../utils/communicationContext';

const MANAGER_ROLES = ['principal', 'institution_manager', 'global_admin', 'platform_admin'];

export default function CommunicationLauncherButton({
  context,
  onLaunch,
  className = 'btn btn-secondary btn-sm',
  children = 'יצירת מייל ומעקב',
  title,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { userData } = useAuth();
  const { permissions } = usePermissions();
  const allowed = permissions['communications.create'] === true || MANAGER_ROLES.includes(userData?.role);
  if (!allowed) return null;

  function launch(event) {
    event?.stopPropagation?.();
    const normalized = normalizeCommunicationContext(context);
    if (onLaunch) {
      onLaunch(normalized);
      return;
    }
    navigate('/tasks', {
      state: {
        communicationContext: normalized,
        communicationReturnTo: `${location.pathname}${location.search}`,
      },
    });
  }

  return <button type="button" className={className} onClick={launch} title={title || children}>
    <MailPlus size={15} /> {children}
  </button>;
}
