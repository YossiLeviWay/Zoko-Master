import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import {
  getIdTokenResult,
  getMultiFactorResolver,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  approveSchoolMembership,
  removeSchoolMembership,
} from '../services/adminUserService';
import { recordSchoolLogin } from '../services/firestore/loginActivityRepository';

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

function schoolMembershipIds(data) {
  return [...new Set([
    ...(Array.isArray(data?.schoolIds) ? data.schoolIds : []),
    ...(typeof data?.schoolId === 'string' && data.schoolId ? [data.schoolId] : []),
  ])];
}

async function resolveSchoolOptions(data) {
  const schoolIds = schoolMembershipIds(data);
  const options = await Promise.all(schoolIds.map(async schoolId => {
    try {
      const snapshot = await getDoc(doc(db, 'schools', schoolId));
      if (!snapshot.exists() || snapshot.data().status === 'disabled') return null;
      const school = snapshot.data();
      return {
        id: schoolId,
        name: typeof school.name === 'string' && school.name.trim() ? school.name.trim() : schoolId,
        code: typeof school.code === 'string' ? school.code : '',
      };
    } catch {
      // The membership is still authoritative. A label fallback keeps old school
      // records usable while Firestore rules continue to enforce actual access.
      return { id: schoolId, name: schoolId, code: '' };
    }
  }));
  return options.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [globalAdminClaim, setGlobalAdminClaim] = useState(false);
  const [platformAdminClaim, setPlatformAdminClaim] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [availableSchools, setAvailableSchools] = useState([]);

  async function login(email, password) {
    let credential;
    try {
      credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      if (error?.code !== 'auth/multi-factor-auth-required') throw error;
      const resolver = getMultiFactorResolver(auth, error);
      const totpHint = resolver.hints.find(hint => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      if (!totpHint) throw Object.assign(new Error('UNSUPPORTED_MFA_FACTOR'), { code: 'auth/unsupported-mfa-factor' });
      const oneTimeCode = window.prompt('הזינו קוד חד־פעמי מאפליקציית האימות:');
      if (!oneTimeCode) throw Object.assign(new Error('MFA_REQUIRED'), { code: 'auth/mfa-code-required' });
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, oneTimeCode.trim());
      credential = await resolver.resolveSignIn(assertion);
    }
    try {
      const token = await getIdTokenResult(credential.user, true);
      const isPlatformAdminClaim = token.claims.platform_admin === true;
      const isLegacyGlobalAdmin = token.claims.global_admin === true;
      const snapshot = await getDoc(doc(db, 'users', credential.user.uid));
      const normalized = normalizeUserData(credential.user, snapshot.data(), isLegacyGlobalAdmin, isPlatformAdminClaim);
      if (!normalized.hasValidUserDocument || normalized.accountStatus !== 'active') {
        throw Object.assign(new Error('ACCOUNT_NOT_ACTIVE'), { code: 'account-not-active' });
      }
      const adminLogin = isPlatformAdminClaim || isLegacyGlobalAdmin;
      const schools = adminLogin ? [] : await resolveSchoolOptions(normalized);
      if (!adminLogin && schools.length === 0) {
        const error = Object.assign(new Error('SCHOOL_MEMBERSHIP_REQUIRED'), { code: 'school-membership-required' });
        throw error;
      }
      setPlatformAdminClaim(isPlatformAdminClaim);
      setGlobalAdminClaim(isLegacyGlobalAdmin);
      setUserData(normalized);
      setAvailableSchools(schools);
      setSelectedSchool(null);
      return { credential, requiresSchoolSelection: !adminLogin, schools };
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      setUserData(null);
      setAvailableSchools([]);
      setSelectedSchool(null);
      setGlobalAdminClaim(false);
      setPlatformAdminClaim(false);
      throw error;
    }
  }

  async function completeSchoolLogin(schoolId) {
    const authenticatedUser = auth.currentUser;
    if (!authenticatedUser || !schoolMembershipIds(userData).includes(schoolId)) {
      throw Object.assign(new Error('SCHOOL_MEMBERSHIP_REQUIRED'), { code: 'school-membership-required' });
    }
    const school = availableSchools.find(item => item.id === schoolId);
    if (!school) {
      throw Object.assign(new Error('SCHOOL_MEMBERSHIP_REQUIRED'), { code: 'school-membership-required' });
    }
    setSelectedSchool(schoolId);
    await recordSchoolLogin({
      db,
      userId: authenticatedUser.uid,
      schoolId,
    }).catch(() => undefined);
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
    setAvailableSchools([]);
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
      const schools = platformClaim || claim ? [] : await resolveSchoolOptions(normalized);
      setAvailableSchools(schools);
      const memberships = new Set(schools.map(item => item.id));
      setSelectedSchool(previous => memberships.has(previous) ? previous : null);
      return normalized;
    } catch {
      const fallback = minimalPendingUser(user);
      setUserData(fallback);
      setAvailableSchools([]);
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
    if (globalAdminClaim || availableSchools.some(school => school.id === schoolId)) {
      setSelectedSchool(schoolId);
    }
  }

  function isPlatformAdmin() {
    return platformAdminClaim === true;
  }

  function isGlobalAdmin() {
    return globalAdminClaim === true;
  }

  function isPrincipal() {
    const schoolId = selectedSchool || userData?.schoolId;
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
        setAvailableSchools([]);
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
    availableSchools,
    loading,
    login,
    completeSchoolLogin,
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
