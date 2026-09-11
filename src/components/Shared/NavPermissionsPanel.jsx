import PagePermissionsPanel from './PagePermissionsPanel';
export const PATH_TO_PERMISSION = {
  '/calendar': 'calendar_view', '/categories': 'categories_view', '/staff': 'staff_view',
  '/tasks': 'tasks_view', '/files': 'files_view', '/teams': 'teams_view',
  '/students': 'students_view', '/contacts': 'contacts.view', '/holidays': 'holidays_view',
  '/messages': 'messages_send', '/settings': 'settings_edit',
};
export default function NavPermissionsPanel({ item, onClose }) {
  return <PagePermissionsPanel feature={item.path.slice(1)} onClose={onClose} />;
}
