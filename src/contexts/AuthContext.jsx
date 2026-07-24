import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import {
  getIdTokenResult,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  approveSchoolMembership,
  removeSchoolMembership,
  setActiveSchool as validateActiveSchool,
} from '../services/adminUserService';

const AuthContext = createContext(null);
const ALLOWED_ROLES = new Set(['viewer', 'editor', 'principal', 'institution_manager']);

export function useAuth() {
  return useContext(AuthContext);
}

function minimalPendingUser(user) {
  return {
    uid: user.uid,
    email: user.email || '',
    fullName: user.displayName || 'משתמש',
    role: 'viewer',
    jobTitle: '',
    schoolId: '',
    schoolIds: [],
    pendingSchools: [],
    permissions: {},
    customRoleIds: [],
    teamIds: [],
    avatar: '',
    phone: '',
    accountStatus: 'pending',
    hasValidUserDocument: false,
  };
}

function normalizeUserData(user, data, globalAdminClaim, platformAdminClaim = false) {
  if (!data || data.uid !== user.uid) return minimalPendingUser(user);

  const role = platformAdminClaim
    ? 'platform_admin'
    : globalAdminClaim ? 'global_admin'
    : ALLOWED_ROLES.has(data.role) ? data.role : 'viewer';

  return {
    ...data,
    uid: user.uid,
    email: user.email || data.email || '',
    fullName: typeof data.fullName === 'string' ? data.fullName : 'משתמש',
    role,
    schoolId: typeof data.schoolId === 'string' ? data.schoolId : '',
    schoolIds: Array.isArray(data.schoolIds) ? data.schoolIds.filter(id => typeof id === 'string') : [],
    pendingSchools: Array.isArray(data.pendingSchools)
      ? data.pendingSchools.filter(id => typeof id === 'string')
      : [],
    permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
    customRoleIds: Array.isArray(data.customRoleIds) ? data.customRoleIds : [],
    teamIds: Array.isArray(data.teamIds) ? data.teamIds : [],
    accountStatus: data.accountStatus || 'active',
    hasValidUserDocument: true,
  };
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [globalAdminClaim, setGlobalAdminClaim] = useState(false);
  const [platformAdminClaim, setPlatformAdminClaim] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState(null);

  async function login(email, password, schoolId) {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    try {
      const token = await getIdTokenResult(credential.user, true);
      const isPlatformAdminClaim = token.claims.platform_admin === true;
      const isLegacyGlobalAdmin = token.claims.global_admin === true;
      const snapshot = await getDoc(doc(db, 'users', credential.user.uid));
      const normalized = normalizeUserData(credential.user, snapshot.data(), isLegacyGlobalAdmin, isPlatformAdminClaim);
      const memberships = new Set(normalized.schoolIds || []);
      if (normalized.schoolId) memberships.add(normalized.schoolId);
      if (!schoolId || (!isPlatformAdminClaim && !isLegacyGlobalAdmin && !memberships.has(schoolId))) {
        const error = new Error('SCHOOL_MEMBERSHIP_REQUIRED');
        error.code = 'school-membership-required';
        throw error;
      }
      await validateActiveSchool({ schoolId });
      setPlatformAdminClaim(isPlatformAdminClaim);
      setGlobalAdminClaim(isLegacyGlobalAdmin);
      setUserData(normalized);
      setSelectedSchool(schoolId);
      return credential;
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      throw error;
    }
  }

  async function logout() {
    if (currentUser) {
      try {
        await updateDoc(doc(db, 'users', currentUser.uid), {
          isOnline: false,
          lastSeen: serverTimestamp(),
        });
      } catch {
        // Presence is best-effort and must never block logout.
      }
    }
    setUserData(null);
    setSelectedSchool(null);
    setGlobalAdminClaim(false);
    setPlatformAdminClaim(false);
    return signOut(auth);
  }

  const loadUserData = useCallback(async (uid, user, claim, platformClaim = false) => {
    if (!user || user.uid !== uid) return null;
    try {
      const snapshot = await getDoc(doc(db, 'users', uid));
      if (!snapshot.exists()) {
        const fallback = minimalPendingUser(user);
        setUserData(fallback);
        setSelectedSchool(null);
        return fallback;
      }

      const normalized = normalizeUserData(user, snapshot.data(), claim, platformClaim);
      setUserData(normalized);
      const memberships = normalized.schoolIds.length > 0
        ? normalized.schoolIds
        : normalized.schoolId ? [normalized.schoolId] : [];
      setSelectedSchool(previous => memberships.includes(previous)
        ? previous
        : memberships.includes(normalized.activeSchoolId) ? normalized.activeSchoolId : memberships[0] || null);
      return normalized;
    } catch {
      const fallback = minimalPendingUser(user);
      setUserData(fallback);
      setSelectedSchool(null);
      return fallback;
    }
  }, []);

  async function fetchUserData(uid) {
    return loadUserData(uid, currentUser, globalAdminClaim, platformAdminClaim);
  }

  async function approveUser(userId, schoolId) {
    await approveSchoolMembership({ userId, schoolId });
  }

  async function rejectUser(userId, schoolId) {
    await removeSchoolMembership({ userId, schoolId, pendingOnly: true });
  }

  async function switchSchool(schoolId) {
    const memberships = userData?.schoolIds || [];
    const legacyMembership = userData?.schoolId === schoolId;
    if (platformAdminClaim || globalAdminClaim || memberships.includes(schoolId) || legacyMembership) {
      await validateActiveSchool({ schoolId });
      setSelectedSchool(schoolId);
    }
  }

  function isPlatformAdmin() {
    return platformAdminClaim === true;
  }

  function isGlobalAdmin() {
    return platformAdminClaim === true || globalAdminClaim === true;
  }

  function isPrincipal() {
    const schoolId = selectedSchool || userData.schoolId;
    const schoolRole = userData?.rolesBySchool?.[schoolId] || userData?.role;
    if (!['principal', 'institution_manager'].includes(schoolRole)) return false;
    return Boolean(schoolId && (
      userData.schoolId === schoolId || userData.schoolIds?.includes(schoolId)
    ));
  }

  function isEditor() {
    return userData?.role === 'editor';
  }

  function isPending() {
    if (!userData) return true;
    if (platformAdminClaim || globalAdminClaim) return false;
    if (!userData.hasValidUserDocument || userData.accountStatus !== 'active') return true;
    return !(userData.schoolIds?.length > 0 || userData.schoolId);
  }

  function isViewer() {
    return userData?.role === 'viewer';
  }

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async user => {
      setLoading(true);
      setCurrentUser(user);
      if (!user) {
        setUserData(null);
        setSelectedSchool(null);
        setGlobalAdminClaim(false);
        setPlatformAdminClaim(false);
        setLoading(false);
        return;
      }

      try {
        const token = await getIdTokenResult(user);
        const hasClaim = token.claims.global_admin === true;
        const hasPlatformClaim = token.claims.platform_admin === true;
        setGlobalAdminClaim(hasClaim);
        setPlatformAdminClaim(hasPlatformClaim);
        await loadUserData(user.uid, user, hasClaim, hasPlatformClaim);
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            isOnline: true,
            lastSeen: serverTimestamp(),
          });
        } catch {
          // A missing/pending profile intentionally cannot create itself.
        }
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, [loadUserData]);

  useEffect(() => {
    if (!currentUser || !userData?.hasValidUserDocument) return undefined;
    const interval = window.setInterval(() => {
      updateDoc(doc(db, 'users', currentUser.uid), {
        lastSeen: serverTimestamp(),
        isOnline: true,
      }).catch(() => undefined);
    }, 120000);
    return () => window.clearInterval(interval);
  }, [currentUser, userData?.hasValidUserDocument]);

  const value = {
    currentUser,
    userData,
    selectedSchool,
    loading,
    login,
    logout,
    switchSchool,
    isGlobalAdmin,
    isPlatformAdmin,
    isPrincipal,
    isEditor,
    fetchUserData,
    approveUser,
    rejectUser,
    isPending,
    isViewer,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
