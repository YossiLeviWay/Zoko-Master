import { AVATAR_ICON_PATHS, AVATAR_OPTIONS } from '../../data/avatars';

function avatarInitial(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return normalized ? normalized.charAt(0) : '?';
}

export default function UserAvatar({
  user,
  avatarId,
  name,
  className = '',
  iconSize = 18,
  style,
  ...props
}) {
  const resolvedAvatarId = avatarId ?? user?.avatar ?? '';
  const resolvedName = name ?? user?.fullName ?? user?.displayName ?? user?.email ?? '';
  const avatar = AVATAR_OPTIONS.find(option => option.id === resolvedAvatarId);
  const iconPath = avatar?.icon ? AVATAR_ICON_PATHS[avatar.icon] : null;

  return (
    <div
      className={className}
      style={{
        ...(avatar ? { background: avatar.bg, color: avatar.textColor } : {}),
        ...style,
      }}
      aria-label={`אוואטר של ${resolvedName || 'המשתמש'}`}
      {...props}
    >
      {iconPath ? (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={iconPath} />
        </svg>
      ) : (
        avatarInitial(resolvedName)
      )}
    </div>
  );
}
