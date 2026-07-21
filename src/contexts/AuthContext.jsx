import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState(null);

  async function register(email, password, userInfo) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const schoolId = userInfo.schoolId || '';
    const userDoc = {
      uid: cred.user.uid,
      email,
      fullName: userInfo.fullName,
      role: 'viewer',
      jobTitle: userInfo.jobTitle || '',
      schoolId: schoolId,
      schoolIds: [],
      pendingSchools: schoolId ? [schoolId] : [],
      phone: userInfo.phone || '',
      avatar: '',
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', cred.user.uid), userDoc);
    return cred;
  }

  async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
    if (userDoc.data()?.disabled) {
      await signOut(auth);
      const error = new Error('החשבון הושבת. יש לפנות למנהל המערכת.');
      error.code = 'auth/user-disabled';
      throw error;
    }
    return cred;
  }

  async function logout() {
    // Mark user as offline before signing out
    if (currentUser) {
      try { await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: new Date().toISOString() }); } catch {}
    }
    setUserData(null);
    setSelectedSchool(null);
    return signOut(auth);
  }

  async function fetchUserData(uid) {
    try {
      const docSnap = await getDoc(doc(db, 'users', uid));
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserData(data);
        if (data.schoolIds && data.schoolIds.length > 0) {
          setSelectedSchool(data.schoolIds[0]);
        } else if (data.schoolId) {
          setSelectedSchool(data.schoolId);
        }
        return data;
      }
    } catch (err) {
      console.warn('fetchUserData error:', err.code, err.message);
    }
    return null;
  }

  function buildFallbackUserData(user) {
    return {
      uid: user.uid,
      email: user.email || '',
      fullName: user.displayName || user.email?.split('@')[0] || 'משתמש',
      role: 'viewer',
      jobTitle: '',
      schoolId: '',
      schoolIds: [],
      pendingSchools: [],
      avatar: '',
      phone: '',
    };
  }

  async function approveUser(userId, schoolId) {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      pendingSchools: arrayRemove(schoolId),
      schoolIds: arrayUnion(schoolId)
    });
  }

  async function rejectUser(userId, schoolId) {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      pendingSchools: arrayRemove(schoolId)
    });
  }

  function switchSchool(schoolId) {
    setSelectedSchool(schoolId);
  }

  function isGlobalAdmin() {
    return userData?.role === 'global_admin';
  }

  function isPrincipal() {
    return userData?.role === 'principal';
  }

  function isEditor() {
    return userData?.role === 'editor';
  }

  function isPending() {
    if (!userData) return false;
    if (userData.role === 'global_admin') return false;
    const hasApprovedSchools = (userData.schoolIds && userData.schoolIds.length > 0) || userData.schoolId;
    const hasPending = userData.pendingSchools && userData.pendingSchools.length > 0;
    return !hasApprovedSchools && hasPending;
  }

  function isViewer() {
    return userData?.role === 'viewer';
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const data = await fetchUserData(user.uid);
          if (data?.disabled) {
            setCurrentUser(null);
            setUserData(null);
            await signOut(auth);
            return;
          }
          if (!data) {
            // Firestore doc missing or rules blocked — use Auth info as fallback
            const fallback = buildFallbackUserData(user);
            setUserData(fallback);
            // Try to create the missing doc
            try {
              await setDoc(doc(db, 'users', user.uid), { ...fallback, createdAt: new Date().toISOString() });
            } catch (error) {
              console.warn('Could not create missing user profile:', error);
            }
          }
          setCurrentUser(user);
          try {
            await updateDoc(doc(db, 'users', user.uid), { isOnline: true, lastSeen: new Date().toISOString() });
          } catch (error) {
            console.warn('Could not update online status:', error);
          }
        } else {
          setCurrentUser(null);
          setUserData(null);
          setSelectedSchool(null);
        }
      } catch (err) {
        console.error('Auth state error:', err);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  // Periodic heartbeat to keep online status fresh (every 2 minutes)
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: new Date().toISOString(), isOnline: true })
        .catch(() => {});
    }, 120000);
    // Mark offline on page close
    function handleBeforeUnload() {
      updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: new Date().toISOString() })
        .catch(() => {});
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUser]);

  const value = {
    currentUser,
    userData,
    selectedSchool,
    loading,
    register,
    login,
    logout,
    switchSchool,
    isGlobalAdmin,
    isPrincipal,
    isEditor,
    fetchUserData,
    approveUser,
    rejectUser,
    isPending,
    isViewer
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
